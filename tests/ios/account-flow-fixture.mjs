// Local-only synthetic backend for an UNSIGNED simulator build. Never production.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const userId='29000000-0000-0000-0000-000000000001',companyId='29000000-0000-0000-0000-000000000100';
const jwt=`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:userId,exp:4102444800,role:'authenticated'})).toString('base64url')}.synthetic`;
export function createFixtureServer() {
  const state={signups:0,companies:0,trialCalls:0,deletionRequests:0,metadata:{},email:'ios-smoke@example.test',member:false,receipt:null};
  const user=()=>({id:userId,email:state.email,aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',user_metadata:state.metadata,app_metadata:{},identities:[{id:userId}]});
  const session=()=>({access_token:jwt,refresh_token:'synthetic-refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:user()});
  const company=()=>({id:companyId,name:'Simulator Perde',onboarding_completed:true,is_active:true,plan_status:'trial',trial_ends_at:'2099-01-01T00:00:00Z',subscription_plan:'starter',package_code:'solo',read_only:false,enabled_modules:['admin','measurements','orders','customers','appointments','suppliers','installation','collections']});
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'); const path=url.pathname;
    const reply=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'});res.end(JSON.stringify(body));};
    if(req.method==='OPTIONS') return reply({});
    let raw=''; for await(const chunk of req) raw+=chunk;
    let body={}; try{body=raw?JSON.parse(raw):{};}catch{return reply({message:'Invalid JSON'},400);}
    if(path==='/__state') return reply({signups:state.signups,companies:state.companies,trialCalls:state.trialCalls,deletionRequests:state.deletionRequests});
    if(path.endsWith('/app_platform_releases')) return reply(null);
    if(path.endsWith('/auth/v1/signup')){state.signups++;state.email=body.email;state.metadata=body.data||{};return reply({...user(),email_confirmed_at:null});}
    // The fixture simulates successful email verification; it sends no email.
    if(path.endsWith('/auth/v1/token')||path.endsWith('/auth/v1/verify')) return reply(session());
    if(path.endsWith('/auth/v1/user')) return reply(user());
    if(path.endsWith('/auth/v1/recover')||path.endsWith('/auth/v1/resend')||path.endsWith('/auth/v1/logout')) return reply({});
    if(path.endsWith('/rpc/get_current_auth_context')) return reply([{role:'admin',is_active:true}]);
    if(path.endsWith('/rpc/claim_pending_invites_for_current_user')) return reply([]);
    if(path.endsWith('/rpc/start_self_service_trial')){state.trialCalls++;if(!state.member)state.companies++;state.member=true;return reply({company_id:companyId,created:state.companies===1,plan_status:'trial',trial_ends_at:'2099-01-01T00:00:00Z'});}
    if(path.endsWith('/company_members')) {
      if((url.searchParams.get('select')||'').includes('is_owner'))return reply({is_owner:true,allowed_modules:null});
      return reply(state.member?[{company_id:companyId,user_id:userId,role:'admin',is_active:true,is_owner:true,created_at:'2026-01-01',companies:company()}]:[]);
    }
    if(path.endsWith('/companies')) return reply(company());
    if(path.endsWith('/profiles')) return reply({user_id:userId,role:'admin',is_active:true});
    if(path.endsWith('/rpc/company_subscription_access_allowed')) return reply(true);
    if(path.endsWith('/rpc/company_subscription_access_snapshot')) return reply({access_allowed:true,access_kind:'trial',access_expires_at:'2099-01-01T00:00:00Z',server_time:new Date().toISOString()});
    if(path.endsWith('/rpc/register_device_and_touch_login')) return reply('active');
    if(path.endsWith('/rpc/request_my_account_deletion')) {
      if(body.p_confirm!=='HESABIMI SIL')return reply({message:'CONFIRM_REQUIRED'},400);
      state.deletionRequests++;
      state.receipt??={id:'29000000-0000-0000-0000-000000000201',receipt_secret:'29000000-0000-0000-0000-000000000202',status:'pending',requested_at:new Date().toISOString(),due_at:new Date(Date.now()+7*86400000).toISOString(),completed_at:null,completion_note:null};
      return reply(state.receipt);
    }
    if(path.endsWith('/rpc/get_account_deletion_receipt'))return reply(state.receipt&&body.p_id===state.receipt.id&&body.p_secret===state.receipt.receipt_secret?state.receipt:null);
    return reply([]);
  });
  return {server,state};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const {server}=createFixtureServer();
  server.listen(54329,'127.0.0.1',()=>console.log('Synthetic iOS fixture listening on loopback:54329'));
}
