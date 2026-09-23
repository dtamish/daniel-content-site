#!/usr/bin/env node
// Fail closed before a production build; Astro otherwise publishes a blank room.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const project='sinai-concept-room-dd26';
const keys=['PROJECT_ID','AUTH_DOMAIN','API_KEY','STORAGE_BUCKET','APP_ID'];
export function validateFirebaseConfig(v){
 const errors=[];
 for(const k of keys)if(!v[`PUBLIC_FIREBASE_${k}`]||/REDACTED|PLACEHOLDER|YOUR[_ -]/i.test(v[`PUBLIC_FIREBASE_${k}`]))errors.push(k);
 if(v.PUBLIC_FIREBASE_PROJECT_ID!==project)errors.push('PROJECT_ID');
 if(v.PUBLIC_FIREBASE_AUTH_DOMAIN!==`${project}.firebaseapp.com`)errors.push('AUTH_DOMAIN');
 if(!/^AIza[A-Za-z0-9_-]{35}$/.test(v.PUBLIC_FIREBASE_API_KEY||''))errors.push('API_KEY');
 if(v.PUBLIC_FIREBASE_STORAGE_BUCKET!==`${project}.firebasestorage.app`)errors.push('STORAGE_BUCKET');
 if(!/^1:760813834561:web:[A-Za-z0-9]+$/.test(v.PUBLIC_FIREBASE_APP_ID||''))errors.push('APP_ID');
 return [...new Set(errors)];
}
function main(){
 const envFile=resolve('.env.production');
 const fromFile={};
 if(existsSync(envFile))for(const line of readFileSync(envFile,'utf8').split(/\r?\n/)){
  const m=line.match(/^(PUBLIC_FIREBASE_[A-Z_]+)=(.*)$/);if(m)fromFile[m[1]]=m[2].trim();
 }
 const values=Object.fromEntries(keys.map(k=>{const name=`PUBLIC_FIREBASE_${k}`;return[name,process.env[name]??fromFile[name]]}));
 const failed=validateFirebaseConfig(values);
 if(failed.length){console.error(`Firebase production config invalid or missing: ${failed.join(', ')}. No values printed.`);process.exitCode=1;return}
 console.log(`Firebase public build config validated for ${project}`);
}
if(process.argv[1]&&fileURLToPath(import.meta.url).toLowerCase()===resolve(process.argv[1]).toLowerCase())main();
