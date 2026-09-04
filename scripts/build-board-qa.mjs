import fs from 'node:fs';
import {boardQA} from './board-qa.mjs';
const [scenario='three',width='1920',height='1080']=process.argv.slice(2);
for(const [path,url] of [['qa.html',`/__board-qa?width=${width}&height=${height}&case=${scenario}`],['qa-frame.html',`/__board-qa?frame&case=${scenario}`]]){
  const html=boardQA(url,fs.readFileSync('index.html','utf8')).replace(`/__board-qa?frame&case=${scenario}`,'/qa-frame.html');
  fs.writeFileSync(path,html);
}
