// Measure the compiled SQLite list over HTTPS with an actual owner session.
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authHTTPSFixture, owner } from '../service/auth-https-fixture.mjs';
import { buildContent } from '../../scripts/build-content.mjs';
import { startContentShadow } from '../../scripts/start-content-shadow.mjs';
import { launchMeasurementBrowser, runPairs } from './field-load.mjs';

export async function withShadowList(run) {
  const root=mkdtempSync(join(tmpdir(),'cd-https-shadow-list-'));
  const rawRoot=join(root,'raw'), output=join(root,'release');
  const service=await authHTTPSFixture();
  try {
    const libraryId='synthetic-list', cards={};
    for(let index=0;index<20;index++) {
      const id='card-'+String(index+1).padStart(2,'0'),who='学科'+(index%5+1), dir=join(rawRoot,who,id);
      mkdirSync(dir,{recursive:true});
      writeFileSync(join(dir,'article.md'),'---\nname: 合成卡 '+(index+1)+'\n---\n\n## 核心理解\n\n记录一次观察。\n');
      cards[id]={id,updated:'20261123080000'};
    }
    const metadataFile=join(root,'metadata.json'),baselineFile=join(root,'baseline.json');
    writeFileSync(metadataFile,JSON.stringify({version:1,libraryId,cards,readings:{},history:{sources:{},proposals:{},events:{}}}));
    writeFileSync(baselineFile,JSON.stringify({version:1,libraryId,sources:[],proposals:[],events:[]}));
    buildContent({rawRoot,metadataFile,baselineFile,output});
    const file=join(root,'shadow.json');
    writeFileSync(join(root,'agent-token'),randomUUID(),{mode:0o600});
    writeFileSync(file,JSON.stringify({backend:'content-shadow',publicUrl:service.url,port:0,libraryId,
      auth:{mode:'required',databaseFile:'shadow-auth.sqlite'},agentTokenFile:'agent-token',contentRelease:output}));
    await service.withShadow(async oldAuth=>{
      copyFileSync(oldAuth,join(root,'shadow-auth.sqlite'));
      return startContentShadow(file);
    },()=>run(service));
  } finally {
    await service.close();
    rmSync(root,{recursive:true,force:true});
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  execFileSync(process.execPath,['scripts/build-web.mjs'],{stdio:'ignore'});
  await withShadowList(async service=>{
    const browser=await launchMeasurementBrowser(service);
    try {
      const report=await runPairs(browser,{target:new URL(service.url+'/cards'),view:'cards',selector:'.card-title-link',
        count:20,timeout:30000,fixture:true,embedded:true,syntheticOwner:owner,readProgramRequests:service.programRequests});
      const limits = {coldProgramBytes:80000,coldTotalBytes:120000,revisitTotalBytes:5000};
      const sampleWithinBudget = sample => {
        if (sample.failure || !sample.atReadable) return false;
        const total = sample.atReadable.bodies.totalBytes, program = sample.atReadable.jsCss.totalBytes;
        return total !== null && program !== null && (sample.visit === 'cold'
          ? program < limits.coldProgramBytes && total < limits.coldTotalBytes
          : total < limits.revisitTotalBytes && program === 0 && sample.fixtureServerProgramRequests === 0);
      };
      const passed = report.samples.length === 10 && report.samples.every(sampleWithinBudget);
      console.log(JSON.stringify({...report,budgets:{limits,passed}},null,2));
      if (!passed) process.exitCode=1;
    } finally{await browser.close();}
  });
}
