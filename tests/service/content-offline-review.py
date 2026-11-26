"""Review the dedicated guest's exported observation files without contacting the guest."""
import hashlib
import ipaddress
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path


STAGES = ('import-new', 'start-closed', 'verify-closed', 'publish-approval',
          'publish-listener', 'publish', 'restart-listener', 'restart',
          'close-before-rollback', 'closed-before-rollback', 'previous-listener-closed',
          'previous-closed', 'rollback-approval', 'previous-listener-open', 'rollback')
SNAPSHOTS = ('baseline', 'publish', 'restart', 'rollback', 'finished')
COUNTERS = ('host_probe', 'container_probe', 'host_other', 'container_other')
PRIVATE = tuple(ipaddress.ip_network(value) for value in ('10.0.0.0/8', '172.16.0.0/12',
                                                           '192.168.0.0/16', 'fc00::/7'))


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def timestamp(text):
    value = re.sub(r'(\.\d{6})\d+', r'\1', text.strip()).replace('Z', '+00:00')
    return datetime.fromisoformat(value).timestamp()


def local(address):
    ip = ipaddress.ip_address(address)
    if getattr(ip, 'ipv4_mapped', None):
        ip = ip.ipv4_mapped
    return ip.is_loopback or ip.is_link_local or any(ip in network for network in PRIVATE)


def events(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def nft_state(path, target):
    items = json.loads(path.read_text())['nftables']
    counters = {}
    chains = {}
    rules = {'output': [], 'forward': []}
    stable = []
    for item in items:
        key, value = next(iter(item.items()))
        if key == 'metainfo':
            continue
        require(value['family'] == 'inet', 'Expected IPv4 and IPv6 coverage')
        require(value.get('table', value['name'] if key == 'table' else '') == 'cd_routea_offline', 'Wrong firewall table')
        if key == 'counter':
            counters[value['name']] = value['packets']
            value = {k: v for k, v in value.items() if k not in ('packets', 'bytes')}
        if key == 'chain':
            chains[value['name']] = (value['hook'], value['prio'], value['policy'])
        if key == 'rule':
            rules[value['chain']].append(value['expr'])
        stable.append({key: value})
    require(set(counters) == set(COUNTERS), 'Firewall counters are missing')
    for chain, side, port in [('output', 'host', 46401), ('forward', 'container', 46402)]:
        require(chains.get(chain) == (chain, -20, 'accept'), 'Missing namespace firewall hook')
        rows = [json.dumps(row, sort_keys=True) for row in rules[chain]]
        require(len(rows) == 5, 'Unexpected firewall rule count')
        for row, expected in zip(rows, [('oifname','lo','docker0','return'), ('oifname','br-*','return'),
                                        ('direction','reply','established','related','return'),
                                        (target, 'sport', str(port), 'dport', '443', side+'_probe','1068','reject'),
                                        (side+'_other', '1068', 'reject')]):
            require(all(token in row for token in expected), 'Egress rule differs from the drill contract')
        require(len(rules[chain][-1]) == 3, 'Final default reject has a condition or extra action')
    return counters, json.dumps(stable, sort_keys=True)


def compare_fd_events(records, samples, allowed):
    opaque = [e for e in records if e['syscall'].startswith('execve') and
              (not e.get('program') or e['program'].isdecimal())]
    require(len(opaque) == len(samples), 'FD execution count differs from kernel byte samples')
    pool = list(samples)
    for event in opaque:
        kind = 'numeric' if event.get('program') else 'empty'
        pairs = [(abs(float(e['time'])-float(event['time'])), index) for index,e in enumerate(pool)
                 if (e['pid'],e['syscall'],e['kind']) == (event['pid'],event['syscall'],kind)]
        require(pairs and min(pairs)[0] < 3, 'FD identity not acquired at the same process exec stop')
        digest = pool.pop(min(pairs)[1])['sha256']
        require(re.fullmatch('[0-9a-f]{64}', digest) and digest in allowed, 'FD object is outside independently established executable identities')
    return len(opaque)


def resolve_fd(directory, units):
    def rows(label, suffix):
        path = directory / (label+suffix)
        require(path.is_file() and not path.is_symlink(), 'Missing kernel FD evidence '+path.name)
        return events(path)

    pins = directory / 'control-binaries.sha256'
    if not pins.is_file():
        return {'passed':False,'reason':'FD-only executions lack independently collected executable object hashes'}
    require(not pins.is_symlink(), 'Invalid control executable manifest')
    values = {}
    for line in pins.read_text().splitlines():
        digest, filename = line.split()
        require(re.fullmatch('[0-9a-f]{64}', digest), 'Invalid reference executable digest')
        values[Path(filename).name] = digest
    require(set(values)=={'true','false','runc'} and len(set(values.values()))==3, 'Controls must be distinct executable objects')
    for name in ('true','false'):
        label='fd-control-'+name
        amount=compare_fd_events(rows(label,'.exec.jsonl'),rows(label,'.fd.jsonl'),{values[name]})
        require(amount>0,'Control did not execute a file descriptor')
    version=(directory/'runc.version').read_text().splitlines()[0]
    require(re.fullmatch(r'runc version [0-9]+\.[0-9]+\.[0-9]+(?:[.+~-][a-zA-Z0-9.+~-]+)?',version), 'Independent runtime version control failed')
    trusted=rows('runc-control','.exec.jsonl'); sampled=rows('runc-control','.fd.jsonl')
    named={e['program'] for e in trusted if e.get('program') and not e['program'].isdecimal()}
    require(named=={'runc'}, 'Runtime reference must directly launch only the installed runc')
    require((directory/'runc.package').read_text().strip() in ('runc','containerd.io'), 'Unrecognized runtime reference package')
    runtime={values['runc'],*(e['sha256'] for e in sampled)}
    compare_fd_events(trusted,sampled,runtime)
    amount=0
    for label,records in units.items():
        amount+=compare_fd_events(records,rows(label,'.fd.jsonl'),runtime)
    return {'passed':True,'resolved':amount,'independentRuncVersion':version,'runtimeDigests':sorted(runtime),
            'positiveNegativeControls':'distinct true and false objects invoked with identical decoy argv'}


def same_run(directory, run_file):
    require(run_file.is_file() and not run_file.is_symlink(), 'Trusted owner run.json required')
    owner=json.loads(run_file.read_text()); name=owner['name']; machine=owner['machine']; steps=owner['steps']
    require(re.fullmatch(r'run-[a-f0-9]{12}',name) and re.fullmatch(r'cd-routea-[a-z0-9]+',machine), 'Invalid owner identity')
    def read(name):
        p=directory/name
        require(p.is_file() and not p.is_symlink(), 'Missing owner evidence '+name)
        return p.read_text().strip()
    platform=read('platform').splitlines(); engine=read('engine').split()
    arch={'x86_64':'amd64','aarch64':'arm64'}
    actual=platform[1].split()[-1]; docker_arch=engine[2].split('/')
    require(platform[0]==machine==engine[0] and engine[:3]==steps['initial-inventory']['docker'].split() and
            docker_arch[0]=='linux' and owner['platform']=='linux/'+arch.get(actual, actual) and
            owner['platform']=='linux/'+arch.get(docker_arch[1],docker_arch[1]), 'Trace belongs to another guest or architecture')
    require(not read('baseline.containers'), 'Observation must begin with no running containers')
    current=owner['delivery']; previous=owner['previous']; imported=steps['import-new']
    require(imported['configSha256']==current['configSha256'] and imported['manifestSha256']==current['manifestSha256'] and
            current['configSha256']!=previous['configSha256'] and imported['imageId']!=steps['initial-inventory']['previousImageId'],
            'Owner program or archive identities are inconsistent')
    for stage,package,image in [('publish',current,imported['imageId']),('restart',current,imported['imageId']),
                                ('rollback',previous,steps['initial-inventory']['previousImageId'])]:
        unit=steps[stage]; tag=package['imageRef']
        require(re.fullmatch('[0-9a-f]{64}',package['configSha256']) and tag=='concept-discovery-offline:'+package['configSha256'] and
                re.fullmatch(r'sha256:[0-9a-f]{64}',image) and image==unit['imageId'] and re.fullmatch('[0-9a-f]{64}',unit['containerId']),
                'Owner immutable image or container identity missing at '+stage)
        require(read(stage+'.containers').split()==[unit['containerId'],tag,name+'-app-1'], 'Observed container belongs to another run or program at '+stage)
    require(read('finished.containers')==read('rollback.containers'), 'Container changed before end of observation')
    return {'run':name,'machine':machine,'platform':owner['platform'],'sameRunContainers':3}


def review(directory, run_file=None):
    ownership=same_run(directory,run_file or directory.parent/'run.json')
    def file(name):
        path = directory / name
        require(path.is_file() and not path.is_symlink(), f'Missing regular observation file {name}')
        return path

    target = str(ipaddress.IPv4Address(file('github-ipv4').read_text().strip()))
    require(ipaddress.ip_address(target).is_global, 'GitHub probe target is nonpublic')
    start = timestamp(file('start.time').read_text())
    finish = timestamp(file('finish.time').read_text())
    require(start < finish, 'Incomplete observation interval')
    snapshots = {}
    times = {}
    original = None
    for stage in SNAPSHOTS:
        counters, rules = nft_state(file(stage+'.nft.json'), target)
        require(original in (None, rules), 'Firewall changed during deployment')
        original = rules
        snapshots[stage] = counters
        times[stage] = timestamp(file(stage+'.time').read_text())
    require([*times.values()] == sorted(times.values()) and start <= times['baseline'] < times['finished'] <= finish,
            'Firewall snapshots do not span the three deployments')
    require(not any(snapshots['baseline'].values()), 'Baseline counters are nonzero')
    require(snapshots['rollback'] == snapshots['finished'], 'Unreviewed traffic after the final deployment snapshot')

    intervals = {}
    traces = []
    units = {}
    stages = {}
    for stage in ('exec-control', *STAGES):
        a = timestamp(file(stage+'.start').read_text()); b, code = file(stage+'.end').read_text().split()
        b = timestamp(b)
        require(start <= a <= b <= finish and code == '0', 'Invalid or failed traced stage '+stage)
        if intervals:
            require(a >= next(reversed(intervals.values()))[1], 'Overlapping or reordered deployment steps')
        intervals[stage] = (a, b)
        row = events(file(stage+'.exec.jsonl'))
        require(all(a-2 <= float(e['time']) <= b+2 for e in row), 'Event falls outside the recorded stage '+stage)
        programs = {e.get('program') for e in row if e.get('program')}
        require(('true' if stage == 'exec-control' else 'python3') in programs, 'Missing process positive control in '+stage)
        stages[stage] = {'execEvents':sum(e['syscall'].startswith('execve') for e in row), 'programs':sorted(programs)}
        traces.extend(row)
        units[stage] = row
    previous = times['baseline']
    for first, last in [('import-new','publish'),('restart-listener','restart'),('close-before-rollback','rollback')]:
        require(previous <= intervals[first][0] <= intervals[last][1] <= times[last], 'Incomplete deployment interval '+last)
        previous = times[last]
    for stage in ('import-new','publish-listener','restart-listener','previous-listener-open'):
        require('docker' in stages[stage]['programs'], 'Missing deployment Docker CLI control in '+stage)

    probes = []
    last = {'host':0, 'container':0}
    for line in file('probes.txt').read_text().splitlines():
        dt, source, before, after = line.split()[:4]
        when = timestamp(dt); before, after = int(before), int(after)
        require(source in last and times['baseline'] <= when <= times['finished'] and before == last[source] and after > before,
                'Unattributed or discontinuous probe counts')
        if probes:
            require(when >= probes[-1][0], 'Probe chronology changed')
        last[source] = after
        probes.append((when, source, after))
    for stage, minimum in [('publish',(1,2)),('restart',(1,3)),('rollback',(2,4))]:
        through = [(t,s,n) for t,s,n in probes if t <= times[stage]]
        for source, expected in zip(('host','container'), minimum):
            values = [n for _,s,n in through if s == source]
            require(len(values) >= expected and values[-1] == snapshots[stage][source+'_probe'], 'Missing '+source+' probe at '+stage)
        require(any(intervals[stage][1] <= t <= times[stage] and s=='container' for t,s,_ in through), 'Missing in-container post-stage probe at '+stage)
    require(any(t < intervals['import-new'][0] and s=='host' for t,s,_ in probes) and
            any(t < intervals['import-new'][0] and s=='container' for t,s,_ in probes), 'Missing before-import dual probe')

    service = events(file('services.exec.jsonl')); traces.extend(service); units['services'] = service
    require(service and all(start-2 <= float(e['time']) <= finish+2 for e in service), 'Service trace missing or outside observation')
    programs = Counter(e.get('program') for e in traces if e['syscall'].startswith('execve'))
    git = sorted(p for p in programs if p and re.fullmatch(r'git(?:[.-].*)?|gitsh|gh',p,re.I))
    require(not git, 'Observed a Git or GitHub client executable')
    # NFLOG and the guest clock can differ by about one second. Pair each public
    # connect with a single controlled window, PID and prior node exec in the same tree.
    launch={}
    for stage in ('start-closed','publish-listener','restart-listener','previous-listener-closed','previous-listener-open'):
        a,b=intervals[stage]; entrypoints={}; chains=set()
        for e in service:
            when=float(e['time']); pid=e['pid']
            if not a<=when<=b:
                continue
            if e.get('program')=='docker-entrypoint.sh':
                entrypoints[pid]=when
            if e.get('program')=='node' and pid in entrypoints and entrypoints[pid]<=when:
                chains.add(pid)
        require(len(chains)==1, 'Missing distinct same-PID application entrypoint and Node exec during '+stage)
        launch[stage]=chains.pop()
    node_exec = {(e['pid'],float(e['time'])) for e in service if e.get('program')=='node'}
    container_probes = [t for t,s,_ in probes if s=='container']
    identified = set()
    for e in traces:
        if e.get('family') not in ('AF_INET','AF_INET6'):
            continue
        addr = e.get('address')
        require(addr is not None and e.get('port') is not None, 'Unresolved IP socket in traced process')
        if local(addr):
            continue
        t=float(e['time']); matches = [p for p in container_probes if p-8 <= t <= p+2]
        require(addr==target and e['port']==443 and matches and any(pid==e['pid'] and t-8<=when<=t for pid,when in node_exec),
                'A traced process made an unattributed external connection')
        require(e['pid'] not in launch.values(), 'Probe did not run separately from the application startup')
        identified.add(min(matches,key=lambda p: abs(p-t)))
    require(set(container_probes) == identified, 'Container probe connects are not individually linked to traced Node processes')

    status=file('capture.status').read_text()
    require('listening on nflog:1068' in status and re.search(r'\b0 packets dropped by kernel',status), 'Missing lossless NFLOG completion')
    match = re.search(r'(\d+) packets? captured',status)
    require(match, 'Missing capture packet count')
    lines=[x for x in file('rejected-flows.txt').read_text().splitlines() if x.strip()]
    require(len(lines)==int(match.group(1)), 'Flow metadata count differs from capture')
    totals = Counter(); other = Counter()
    for line in lines:
        m=re.match(r'^(\d+\.\d+) IP6? (\S+) > (\S+?): (.*)$',line)
        require(m is not None,'Unrecognized rejected-flow metadata')
        when,src,dst,protocol=m.groups(); when=float(when)
        require(start-2 <= when <= finish+2, 'Flow outside observer window')
        if dst==target+'.443' and protocol.lower().startswith('tcp') and src.endswith(('.46401','.46402')):
            side='host' if src.endswith('.46401') else 'container'
            require(any(s==side and t-8 <= when <= t+2 for t,s,_ in probes), 'Probe-like packet outside deliberate probe window')
            totals[side+'_probe']+=1
        else:
            # The trace attributes all system/service origins with public connects.
            # Only recognizable infrastructure broadcasts, DHCP and NTP may be
            # classified separately here. A DNS or other ambiguous flow stays open.
            if dst.lower().startswith('ff02:') and protocol.startswith(('HBH ICMP6, ', 'ICMP6, ')):
                origin, destination = ipaddress.IPv6Address(src), ipaddress.IPv6Address(dst)
                require((origin.is_unspecified or origin.is_link_local) and destination in ipaddress.ip_network('ff02::/16'),
                        'Unexpected IPv6 multicast scope')
                message = protocol.split('ICMP6, ', 1)[1]
                if message.startswith('multicast listener report v2, ') and str(destination)=='ff02::16':
                    kind = 'icmp6-multicast-listener'
                elif message.startswith('router solicitation, ') and str(destination)=='ff02::2':
                    kind = 'icmp6-router-solicitation'
                else:
                    nd = re.fullmatch(r'neighbor solicitation, who has ([a-fA-F0-9:]+), length [0-9]+', message)
                    require(nd and ipaddress.IPv6Address(nd.group(1)).is_link_local and
                            destination in ipaddress.ip_network('ff02::1:ff00:0/104'), 'Unexpected IPv6 neighbor discovery packet')
                    kind = 'icmp6-neighbor-solicitation'
            else:
                ok=re.search(r'\.(67|68|123|546|547)$',dst) and any(t in protocol.lower() for t in ('udp','ntp','bootp','dhcp'))
                require(ok, 'Unclassified non-probe external packet requires inspection')
                kind='udp-destination-port-'+dst.rsplit('.',1)[1]
            other[kind]+=1
    end=snapshots['finished']
    require(all(totals[k]==end[k] for k in ('host_probe','container_probe')) and sum(other.values())==end['host_other']+end['container_other'],
            'Flow observations and firewall counters differ')
    require(not end['container_other'], 'Container originated additional outbound traffic')
    reviewed=[p for p in directory.iterdir() if p.is_file() and not p.is_symlink()]
    identity=resolve_fd(directory,units)
    return {'passed':identity['passed'], 'networkPassed':True, 'executionPassed':identity['passed'],
            'reason':identity.get('reason'), 'descriptorIdentity':identity,
            'scope':'guest Docker, containerd, Nginx and their traced descendants plus explicitly wrapped deployment commands; guest namespace IPv4/IPv6 OUTPUT and FORWARD',
            'traceFiles':len(reviewed), 'evidenceSha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(reviewed)},
            'ownership':ownership,'applicationStartupPids':launch,'stageExecutions':stages,'serviceEvents':len(service), 'namedExecs':sum(n for p,n in programs.items() if p),
            'fdOnlyEmptyExecs':programs.get('',0)+programs.get(None,0),'fdOnlyNumericExecs':sum(n for p,n in programs.items() if p and p.isdecimal()),'namedGitExecutions':0,'containerProbeProcessMatches':len(identified),
            'firewallSnapshots':snapshots,'probeSources':dict(Counter(s for _,s,_ in probes)), 'infrastructurePacketsByType':dict(other),
            'capturePackets':len(lines),'captureKernelDrops':0}


if __name__=='__main__':
    try:
        require(len(sys.argv)==2 or (len(sys.argv)==4 and sys.argv[2]=='--run'),'Expected trace directory [--run trusted-run.json]')
        result=review(Path(sys.argv[1]),Path(sys.argv[3]) if len(sys.argv)==4 else None)
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        print(json.dumps({'passed':False,'reason':str(error)},ensure_ascii=False));sys.exit(1)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    sys.exit(0 if result['passed'] else 1)
