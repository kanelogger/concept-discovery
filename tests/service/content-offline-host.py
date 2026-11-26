"""Guest-side acceptance steps. Runs only inside the disposable, isolated Linux test machine."""
import hashlib
import http.client
import json
import os
import re
import shutil
import sqlite3
import ssl
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/var/lib/concept-offline-drill')
NAME, STEP = sys.argv[1:]
if not re.fullmatch('run-[a-f0-9]{12}', NAME) or not Path('/etc/os-release').is_file():
    raise SystemExit('Expected an isolated Linux drill')
BASE = ROOT / NAME
CONFIG = json.loads((BASE / 'fixture.json').read_text())
PORT = 16806
TLS = 18443


def require(test, message):
    if not test:
        raise RuntimeError(message)


def command(*args, env=None):
    return subprocess.check_output(args, text=True, env=env, timeout=240).strip()


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def state(name):
    return json.loads((BASE / (name + '.json')).read_text())


def save(name, obj):
    (BASE / (name + '.json')).write_text(json.dumps(obj))


def docker(*args):
    return command('docker', '--host', 'unix:///run/docker.sock', *args)


def copy_private(name):
    source = BASE / 'next' / name
    target = BASE / 'live' / name
    tmp = target.with_name(target.name + '.new')
    shutil.copyfile(source, tmp)
    tmp.chmod(0o600)
    os.chown(tmp, 1000, 1000)
    tmp.replace(target)


def controls():
    # These bind-mount directories keep their inodes across every checkpoint.
    for name in ['control/approved.json', 'control/deletions.json', 'control/checkpoint.json', 'settings/service.json']:
        copy_private(name)
    config = json.loads((BASE/'live/settings/service.json').read_text())
    require(sha(BASE/'live/control/checkpoint.json') == config['checkpointSha256'], 'Wrong checkpoint')
    return {'checkpointSha256':config['checkpointSha256'], 'deletionsSha256':sha(BASE/'live/control/deletions.json')}


def preload():
    require(not docker('ps','-aq') and not docker('image','ls','-aq'), 'Guest Docker inventory must start empty')
    require(not (BASE/'incoming').exists() and not (BASE/'versions').exists(), 'Candidate already present')
    for parent in ['/var/lib','/home','/opt','/srv','/root','/tmp','/mnt']:
        found = command('find',parent,'-xdev','-name','.git','-print','-quit')
        require(not found, 'Guest has a Git worktree')
    require(sha(BASE/'prior-image.tar') == CONFIG['priorTarSha256'], 'Previous image archive changed')
    docker('image','load','-i',str(BASE/'prior-image.tar'))
    (BASE/'prior-image.tar').unlink()
    data = json.loads(docker('image','inspect',CONFIG['previousImageRef']))[0]
    require(data['Id'].removeprefix('sha256:') in CONFIG['previousIdentifiers'], 'Previous program has unexpected identity')
    require(data['Os']+'/'+data['Architecture']==CONFIG['platform'], 'Unexpected previous platform')
    require(not docker('image','ls','-q',CONFIG['candidateImageRef']), 'Candidate already installed')
    require(not list((BASE/'live').rglob('knowledge.sqlite')), 'Candidate content already present')
    save('before',{'imageId':data['Id'],'imageRef':CONFIG['previousImageRef']})
    return {'initialImageCount':0,'previousImageId':data['Id'],'candidateImagePresent':False,'candidateContentPresent':False,
            'docker':docker('info','-f','{{.Name}} {{.ServerVersion}} {{.OSType}}/{{.Architecture}}'),
            'guestArchitecture':command('dpkg','--print-architecture'),'gitWorktreesFound':0}


def install():
    versions = BASE/'versions'
    versions.mkdir(exist_ok=True)
    installed=json.loads(command('python3',str(BASE/'install.py'),'--delivery',str(BASE/'incoming'),
                                 '--manifest-sha256',CONFIG['deliveryPin'],'--install-root',str(versions)))
    release=Path(installed['releaseDirectory'])
    require(sha(release/'delivery.json')==CONFIG['deliveryPin'],'Installed manifest differs')
    save('candidate',installed)
    shutil.copyfile(release/'readiness.conf',BASE/'nginx-readiness.conf')
    site=Path('/etc/nginx/conf.d')/(NAME+'.conf')
    shutil.copyfile(release/'nginx.conf',site)
    command('nginx','-t')
    command('systemctl','reload','nginx')
    return {k:installed[k] for k in ['imageId','configSha256','manifestSha256','platform']}


def compose(image,*args):
    installed=state('candidate')
    env={**os.environ,'DOCKER_HOST':'unix:///run/docker.sock','CONCEPT_CONTENT_IMAGE':image['imageRef'],
         'CONCEPT_CONTENT_RELEASE':installed['contentDirectory'],'CONCEPT_CONTENT_AUTH':str(BASE/'live/auth'),
         'CONCEPT_CONTENT_SETTINGS':str(BASE/'live/settings'),'CONCEPT_CONTENT_CONTROL':str(BASE/'live/control'),
         'CONCEPT_UID':'1000','CONCEPT_GID':'1000','CONCEPT_PORT':str(PORT)}
    return command('docker','compose','-p',NAME,'-f',str(Path(installed['releaseDirectory'])/'compose.content.yaml'),*args,env=env)


def call(path,expected,*,body=None,cookie=None,proxy=True):
    connection = (http.client.HTTPSConnection('127.0.0.1',TLS,timeout=4,context=ssl.create_default_context(cafile=str(BASE/'tls/cert.pem')))
                  if proxy else http.client.HTTPConnection('127.0.0.1',PORT,timeout=4))
    headers={'Host':'127.0.0.1:'+str(TLS),'Origin':'https://127.0.0.1:'+str(TLS)}
    if path=='/cards':
        headers.update({'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'})
    if cookie: headers['Cookie']=cookie
    if body is not None: headers['Content-Type']='application/json'
    try:
        connection.request('POST' if body is not None else 'GET',path,body=json.dumps(body).encode() if body is not None else None,headers=headers)
        r=connection.getresponse()
        data=r.read()
        # Public errors omit request paths because a preview ID may be present.
        require(r.status==expected,'Unexpected HTTP status %d (expected %d)'%(r.status,expected))
        return data, dict((k.lower(),v) for k,v in r.getheaders())
    finally:
        connection.close()


def wait(check):
    for i in range(80):
        try: return check()
        except (OSError,RuntimeError,http.client.HTTPException):
            if i==79: raise
            time.sleep(.25)


def closed():
    wait(lambda:call('/api/readiness',503,proxy=False))
    wait(lambda:call('/login',500))
    call('/api/card-share/read',500,body=CONFIG['links']['card-c'])
    return {'directReadiness':503,'proxiedLogin':500,'proxiedShare':500}


def start_program(version):
    image=state(version)
    require(compose(image,'config','--services')=='app','Unexpected Compose services')
    compose(image,'up','--no-build','--pull','never','-d','--force-recreate','app')
    return {'expectedImageId':image['imageId']}


def cleanup():
    require((ROOT/'.dedicated-host').read_text().strip()==command('hostname'), 'Wrong cleanup host')
    require(BASE.parent==ROOT and (BASE/'fixture.json').is_file(), 'Missing drill ownership receipt')
    if (BASE/'candidate.json').is_file():
        compose(state('candidate'),'down','--timeout','5')
    site=Path('/etc/nginx/conf.d')/(NAME+'.conf')
    if site.exists():
        site.unlink()
        command('nginx','-t')
        command('systemctl','reload','nginx')
    for key in ['candidateImageRef','previousImageRef']:
        image=CONFIG[key]
        require(re.fullmatch(r'concept-discovery-offline:[0-9a-f]{64}',image), 'Wrong cleanup image')
        if docker('image','ls','-q',image):
            docker('image','rm',image)
    require(not docker('ps','-aq','--filter','label=com.docker.compose.project='+NAME),'Test containers remain')
    require(not docker('network','ls','-q','--filter','label=com.docker.compose.project='+NAME),'Test network remains')
    shutil.rmtree(BASE)
    return {'cleaned':not BASE.exists() and not site.exists()}


def audit(version):
    image=state(version)
    wait(lambda:call('/api/readiness',200,proxy=False))
    wait(lambda:call('/api/readiness',200))
    container=compose(image,'ps','-q','app')
    live=json.loads(docker('inspect',container))[0]
    require(live['Image']==image['imageId'],'Unexpected running program')
    require(live['HostConfig']['ReadonlyRootfs'] and len(docker('ps','-q').splitlines())==1,'Unexpected running service')
    mounts={m['Destination']:(m['Source'],m['RW']) for m in live['Mounts'] if m['Type']=='bind'}
    require(mounts=={'/settings':(str(BASE/'live/settings'),False),'/control':(str(BASE/'live/control'),False),
                    '/auth':(str(BASE/'live/auth'),True),'/content':(state('candidate')['contentDirectory'],False)},'Unexpected mounts')
    data=json.loads((BASE/'live/settings/service.json').read_text())
    release=Path(mounts['/content'][0])
    require(sha(release/'manifest.json')==data['manifestSha256']==CONFIG['contentPin'],'Current content changed')
    checkpoint=json.loads((BASE/'live/control/checkpoint.json').read_text())
    require(sha(BASE/'live/control/checkpoint.json')==data['checkpointSha256'],'Wrong checkpoint')
    require(sha(BASE/'live/control/deletions.json')==checkpoint['deletionsSha256']==CONFIG['deletionsPin'],'Wrong deletion ledger')
    approval=json.loads((BASE/'live/control/approved.json').read_text())
    require(sha(BASE/'live/control/approved.json')==checkpoint['approvedSha256'] and approval['state']=='open','Expected approved open checkpoint')
    with sqlite3.connect((BASE/'live/auth/auth.sqlite').as_uri()+'?mode=ro',uri=True) as db:
        binding=db.execute('SELECT volume_id,generation FROM content_auth_binding WHERE singleton=1 AND ready=1').fetchone()
    identity={'volumeId':binding[0],'generation':binding[1]}
    require(identity==CONFIG['identity']==approval['authIdentity'],'Auth volume changed')
    call('/login',200)
    call('/cards',302)
    _,headers=call('/api/session/login',200,body=CONFIG['credentials'])
    cookie=headers['set-cookie'].split(';',1)[0]
    call('/api/session',200,cookie=CONFIG['cookie'])
    page,_=call('/cards',200,cookie=cookie)
    match=re.search(br'<script type="application/json" id="initial-page">(.*?)</script>',page,re.S)
    require(match is not None and len(json.loads(match[1])['read']['data']['items'])==20,'Missing authenticated first page')
    get='/api/v1/commands/get-document'
    card=json.loads(call(get,200,body={'id':'card-c'},cookie=cookie)[0])['data']
    require(card['id']=='card-c' and card['title']=='合成 card-c','Retained card failed')
    asset=call(CONFIG['asset'],200,cookie=cookie)[0]
    require(hashlib.sha256(asset).hexdigest()==CONFIG['assetSha256'],'Shared image changed')
    for key,link in CONFIG['links'].items():
        expected=200 if key=='card-c' else 404
        payload,_=call('/api/card-share/read',expected,body=link)
        if expected==200: require('旧分享 card-c' in json.loads(payload)['data']['html'],'Wrong frozen share')
        call('/share/'+link['previewId']+'/cover',expected)
    for card_id in ['card-a','card-b']:
        missing=json.loads(call(get,409,body={'id':card_id},cookie=cookie)[0])
        require(missing['error']['code']=='identity_conflict' and 'data' not in missing,'Hidden card was disclosed')
    return {'containerId':container,'imageId':live['Image'],'startedAt':live['State']['StartedAt'],
            'contentSha256':data['manifestSha256'],'checkpointSha256':data['checkpointSha256'],
            'deletionsSha256':checkpoint['deletionsSha256'],'authIdentity':identity,'readiness':200,'ownerLogin':200,
            'originalSession':200,'firstPageCount':20,'retainedCard':200,'sharedAsset':200,'sameValidShare':200,
            'revokedRetainedCardShare':404,'archivedCardShare':404,'deletedCardShare':404,'hiddenCards':409}


if __name__=='__main__':
    if STEP=='preload': result=preload()
    elif STEP=='install': result=install()
    elif STEP=='controls': result=controls()
    elif STEP=='closed': result=closed()
    elif STEP in ['start-candidate','start-before']: result=start_program(STEP.split('-')[1])
    elif STEP=='restart': result={'restarted':compose(state('candidate'),'restart','app')}
    elif STEP in ['audit-candidate','audit-before']: result=audit(STEP.split('-')[1])
    elif STEP=='cleanup': result=cleanup()
    else: raise SystemExit('Unknown drill step')
    print(json.dumps(result))
