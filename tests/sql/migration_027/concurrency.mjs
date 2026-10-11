import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const bin = process.env.TEST_PSQL || "C:/Program Files/PostgreSQL/17/bin/psql.exe";
const args = ["-h","127.0.0.1","-p","55427","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-q","-At"];
function sql(query) { return execFileSync(bin,[...args,"-c",query],{encoding:"utf8",windowsHide:true}).trim(); }
// This fixed localhost test port is deliberately separate from Supabase/production.
sql(`
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('27000000-0000-0000-0000-000000000009','parallel@example.test',now(),'{"perdepro_invite":{"code":"PARALLEL"}}');
 INSERT INTO companies(id,name,plan_status,max_users) VALUES ('27000000-0000-0000-0000-000000000109','Parallel test','active',1);
 INSERT INTO user_invites(company_id,email,role,invite_code,token,expires_at)
 VALUES ('27000000-0000-0000-0000-000000000109','parallel@example.test','installer','PARALLEL','parallel-token',now()+interval '1 day');
`);
const run = (index) => new Promise((resolve,reject) => {
 const command = index%2 ? "SELECT * FROM complete_pending_invite_for_current_user();" : "SELECT * FROM accept_invite_code_for_current_user('parallel@example.test','PARALLEL',NULL);";
 const child=spawn(bin,[...args,"-c",`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000009',true); ${command} COMMIT;`],{windowsHide:true});
 let out="";child.stdout.on("data",d=>out+=d);child.stderr.on("data",d=>out+=d);child.on("error",reject);child.on("exit",code=>code===0?resolve(out):reject(new Error(out)));
});
await Promise.all(Array.from({length:6},(_,i)=>run(i)));
assert.equal(sql("SELECT count(*) FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000009'"),"1");
assert.equal(sql("SELECT accepted_by FROM user_invites WHERE invite_code='PARALLEL'"),"27000000-0000-0000-0000-000000000009");
console.log("PASS: 6 concurrent mixed completion/code calls, exactly 1 membership and correct Auth ID");
// Two different invited users must not race past max_users=1.
sql(`
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('27000000-0000-0000-0000-000000000010','race1@example.test',now()),('27000000-0000-0000-0000-000000000011','race2@example.test',now());
 INSERT INTO companies(id,name,plan_status,max_users) VALUES ('27000000-0000-0000-0000-000000000110','Capacity race','active',1);
 INSERT INTO user_invites(company_id,email,role,invite_code,token,expires_at) VALUES
 ('27000000-0000-0000-0000-000000000110','race1@example.test','installer','RACE1','race1-token',now()+interval '1 day'),
 ('27000000-0000-0000-0000-000000000110','race2@example.test','installer','RACE2','race2-token',now()+interval '1 day');
`);
const race = (i) => new Promise(resolve=> {
 const child=spawn(bin,[...args,"-c",`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-0000000000${i===1?'10':'11'}',true); SELECT * FROM accept_invite_for_current_user('race${i}-token',NULL); COMMIT;`],{windowsHide:true});
 let out="";child.stderr.on("data",d=>out+=d);child.on("exit",code=>resolve({code,out}));
});
const results=await Promise.all([race(1),race(2)]);
assert.equal(results.filter(r=>r.code===0).length,1);
assert.match(results.find(r=>r.code!==0).out,/MEMBER_LIMIT/);
assert.equal(sql("SELECT count(*) FROM company_members WHERE company_id='27000000-0000-0000-0000-000000000110'"),"1");
console.log("PASS: two concurrent different users cannot exceed the one-user company limit");
