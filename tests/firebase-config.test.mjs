import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFirebaseConfig } from '../tools/validate-firebase-config.mjs';
const valid={PUBLIC_FIREBASE_PROJECT_ID:'sinai-concept-room-dd26',PUBLIC_FIREBASE_AUTH_DOMAIN:'sinai-concept-room-dd26.firebaseapp.com',PUBLIC_FIREBASE_API_KEY:`AIza${'x'.repeat(35)}`,PUBLIC_FIREBASE_STORAGE_BUCKET:'sinai-concept-room-dd26.firebasestorage.app',PUBLIC_FIREBASE_APP_ID:'1:760813834561:web:abcdef'};
test('production config fails closed on missing or redacted public Firebase key',()=>{
 assert.deepEqual(validateFirebaseConfig(valid),[]);
 assert.ok(validateFirebaseConfig({...valid,PUBLIC_FIREBASE_API_KEY:'[SECRET REDACTED]'}).includes('API_KEY'));
 assert.ok(validateFirebaseConfig({...valid,PUBLIC_FIREBASE_API_KEY:''}).includes('API_KEY'));
 assert.ok(validateFirebaseConfig({...valid,PUBLIC_FIREBASE_PROJECT_ID:'unrelated'}).includes('PROJECT_ID'));
 assert.ok(validateFirebaseConfig({...valid,PUBLIC_FIREBASE_STORAGE_BUCKET:'other.appspot.com'}).includes('STORAGE_BUCKET'));
});
