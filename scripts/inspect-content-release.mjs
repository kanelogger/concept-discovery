import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openContentReader } from '../server/content-reader.mjs';
import { openContentShareMaterials } from '../server/content-share-materials.mjs';

export function inspectContentRelease(release, libraryId) {
  const directory=realpathSync(release);
  const reader=openContentReader({directory,libraryId,origin:'https://local.invalid'});
  try {
    const {manifestSha256,readerContract,activeIds}=reader.inventory();
    const {digest}=openContentShareMaterials(join(directory,'share-materials'),reader);
    return {libraryId,manifestSha256,readerContract,activeCount:activeIds.length,materialDigest:digest};
  } finally {reader.close();}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const [directory,libraryId,...rest]=process.argv.slice(2);
  if (!directory || directory==='--help' || !libraryId || rest.length) {
    console.log('npm run content:inspect -- <内容包目录> <已经核实的知识库 ID>');
    if (directory!=='--help') process.exitCode=1;
  } else {
    try {console.log(JSON.stringify(inspectContentRelease(directory,libraryId),null,2));}
    catch(error) {console.error(error.message);process.exitCode=1;}
  }
}
