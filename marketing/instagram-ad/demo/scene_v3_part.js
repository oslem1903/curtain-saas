// ---------- S1/S2: açılış (başlık geçiş boyunca okunur) ----------
const NOTES=[];
for(let i=0;i<14;i++){
  const col=i%5;
  NOTES.push({x:90+rnd(i+1)*900,y:780+rnd(i+11)*760,rot:(rnd(i+21)-.5)*.9,w:260+rnd(i+31)*80,h:190+rnd(i+41)*60,
    col:C.note[col],tag:['ölçü?','teklif?','sipariş?','not','randevu?','tahsilat?','ölçü','teklif','sipariş','borç?','tarih?','müşteri?','kumaş','adres'][i],ph:rnd(i+51)*6.28,
    lines:3+Math.floor(rnd(i+61)*3),side:rnd(i+71)<.5?-1:1})}
const TILE=[[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]];
function drawNote(n,x,y,rot,s,alpha,tidy){
  ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x,y);ctx.rotate(rot);ctx.scale(s,s);
  ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=30;ctx.shadowOffsetY=14;
  ctx.fillStyle=tidy?'#f3fafb':n.col;rr(-n.w/2,-n.h/2,n.w,n.h,18);ctx.fill();ctx.shadowColor='transparent';
  ctx.fillStyle=tidy?C.teal2:'rgba(11,47,68,.55)';
  ctx.font=`600 38px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='alphabetic';
  if(!tidy)ctx.fillText(n.tag,-n.w/2+24,-n.h/2+60);
  ctx.strokeStyle=tidy?'rgba(11,47,68,.25)':'rgba(11,47,68,.30)';ctx.lineWidth=7;ctx.lineCap='round';
  for(let l=0;l<n.lines;l++){const yy=-n.h/2+(tidy?60:100)+l*34;ctx.beginPath();ctx.moveTo(-n.w/2+24,yy);
    if(tidy)ctx.lineTo(-n.w/2+24+(n.w-48)*(l%2?.55:.8),yy);
    else for(let k=1;k<=8;k++)ctx.lineTo(-n.w/2+24+k*(n.w-60)/8*(.7+.3*rnd(l*9+k+n.ph)),yy+(k%2?-9:9));
    ctx.stroke()}
  ctx.restore()}
function tape(t,alpha){
  ctx.save();ctx.globalAlpha*=alpha;const k=eo(seg(t,.2,1.4));
  ctx.translate(W/2,1640+Math.sin(t*1.3)*6);ctx.rotate(-.05);
  ctx.fillStyle='#ffd23f';ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=24;ctx.shadowOffsetY=10;
  rr(-640*k,-34,1280*k,68,10);ctx.fill();ctx.shadowColor='transparent';
  ctx.strokeStyle='rgba(30,30,30,.75)';ctx.lineWidth=3;
  for(let i=-30;i<=30;i++){const x=i*21;if(Math.abs(x)>640*k)continue;ctx.beginPath();ctx.moveTo(x,-34);ctx.lineTo(x,i%5?-18:-4);ctx.stroke()}
  ctx.restore()}
function warnTag(label,x,y,rot,t,t0,alpha){
  const k=eob(seg(t,t0,t0+.45));if(k<=0)return;
  ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x,y);ctx.rotate(rot);ctx.scale(k,k);
  ctx.font=`800 38px ${FONT}`;const w=ctx.measureText(label).width+64;
  ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowBlur=24;ctx.shadowOffsetY=10;
  ctx.fillStyle='#ff5a4f';rr(-w/2,-36,w,72,36);ctx.fill();ctx.shadowColor='transparent';
  ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,0,3);ctx.restore()}
function scene1(t){ // 0-7.2
  const out=1-seg(t,6.8,7.2);
  if(out<=0)return;
  ctx.save();ctx.globalAlpha=out;
  const calm=1-seg(t,2.6,3.4);
  NOTES.forEach((n,i)=>{
    const wob=Math.sin(t*2.2+n.ph)*.07*calm;
    let x=n.x+Math.sin(t*1.1+n.ph)*26*calm,y=n.y+Math.cos(t*.9+n.ph)*20*calm,rot=n.rot+wob,s=1,a=1,tidy=false;
    const enter=eo(seg(t,.05+i*.07,.5+i*.07));
    x=lerp(n.side*700+W/2,x,enter);y=y+(1-enter)*260;a=enter;rot+=(1-enter)*n.side*.8;s=lerp(.75,1,enter);
    const k=eio(seg(t,3.0,4.0));
    if(k>0){
      let tx=W/2,ty=1060,tr=0,ts=.25;
      if(i<6){const [cx,cy]=TILE[i];tx=W/2+(cx-1)*270;ty=1390+cy*150;tr=0;ts=.58;tidy=k>.5}
      x=lerp(x,tx,k);y=lerp(y,ty,k);rot=lerp(rot,tr,k);s=lerp(s,ts,k);
      if(i>=6)a*=1-seg(t,3.5,4.1)}
    drawNote(n,x,y,rot,s,a,tidy)});
  ctx.restore();
  // başlık: logo belirene kadar (≈3.9 sn) okunur kalır
  const o=1-seg(t,3.75,4.15);
  if(o>0){
    ctx.save();ctx.globalAlpha=o;tape(t,1);
    warnTag('Ölçü kayıp mı?',300,1000,-.12,t,.9,1);
    warnTag('Tahsilat unutuldu mu?',760,1210,.1,t,1.8,1);
    ctx.restore();
    ctx.save();ctx.globalAlpha=o;
    const gr=ctx.createLinearGradient(0,250,0,850);gr.addColorStop(0,'rgba(4,32,47,.0)');gr.addColorStop(.25,'rgba(4,32,47,.82)');gr.addColorStop(.8,'rgba(4,32,47,.82)');gr.addColorStop(1,'rgba(4,32,47,0)');
    ctx.fillStyle=gr;ctx.fillRect(0,250,W,600);
    const kk=eo(seg(t,.05,.5));
    ctx.save();ctx.globalAlpha*=kk;ctx.font=`800 34px ${FONT}`;const lab='PERDECİLER İÇİN';const lw=ctx.measureText(lab).width+64;
    ctx.fillStyle=C.teal;rr(W/2-lw/2,300,lw,64,32);ctx.fill();ctx.fillStyle=C.bg0;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(lab,W/2,334);ctx.restore();
    rise('Ölçüler, teklifler,',W/2,480,88,800,C.white,t,.25,.6);
    rise('siparişler…',W/2,585,88,800,C.white,t,.5,.6);
    rise('Hepsi ayrı yerde mi?',W/2,725,70,700,C.teal,t,1.3,.6);
    ctx.restore()}
}
function scene2(t){ // 4.0-7.2
  const k=seg(t,4.1,4.9);if(k<=0)return;
  const out=1-seg(t,6.8,7.2);
  ctx.save();ctx.globalAlpha=out;
  const ring=seg(t,4.0,5.0);ctx.save();ctx.globalAlpha*=(1-ring)*.8;ctx.strokeStyle=C.teal;ctx.lineWidth=8;
  ctx.beginPath();ctx.arc(W/2,640,120+ring*520,0,6.283);ctx.stroke();ctx.restore();
  const s=eob(k);const sz=360;
  if(logoReady){ctx.save();ctx.translate(W/2,640);ctx.scale(s,s);ctx.globalAlpha*=eo(seg(t,4.1,4.5));
    ctx.drawImage(logo,-sz/2,-sz/2,sz,sz);ctx.restore()}
  rise('PerdePRO',W/2,1010,140,800,C.white,t,4.6,.6);
  rise('Perde işiniz tek yerde.',W/2,1130,62,600,C.teal,t,5.0,.6);
  ctx.restore()}

// ---------- Gerçek uygulama ekranları (yerel örnek veri, canlı veri yok) ----------
// knots: [sahne süresi (a'dan itibaren), kayıt süresi] — kayıt zamanı parça parça hızlandırılır.
const PH_A=7.2;
const CLIPS={
  olcu:{a:7.2,b:11.6,knots:[[0,0],[.5,1.0],[1.2,2.7],[2.2,5.5],[2.7,6.8],[3.4,8.1],[4.4,9.2]]},
  teklif:{a:11.6,b:18.8,knots:[[0,0],[1.4,2.1],[2.4,3.8],[3.2,4.4],[4.0,5.7],[4.9,7.5],[5.9,9.6],[7.2,11.9]]},
  randevu:{a:18.8,b:22.4,knots:[[0,0],[.5,1.3],[1.1,2.9],[1.7,4.9],[2.0,5.8],[2.3,7.0],[2.8,8.7],[3.6,9.7]]},
  tahsilat:{a:22.4,b:24.6,knots:[[0,.1],[.5,.9],[1.0,2.7],[1.5,3.9],[2.2,5.2]]},
};
const TIMES={},MARKS={},IMGS={},need=new Map();
function mapFwd(c,s){const k=c.knots;if(s<=k[0][0])return k[0][1];for(let i=1;i<k.length;i++)if(s<=k[i][0]){const u=(s-k[i-1][0])/(k[i][0]-k[i-1][0]);return lerp(k[i-1][1],k[i][1],u)}return k.at(-1)[1]}
function mapInv(c,r){const k=c.knots;if(r<=k[0][1])return k[0][0];for(let i=1;i<k.length;i++)if(r<=k[i][1]){const u=(r-k[i-1][1])/(k[i][1]-k[i-1][1]);return lerp(k[i-1][0],k[i][0],u)}return k.at(-1)[0]}
window.loadTimes=async()=>{for(const n of Object.keys(CLIPS)){
  TIMES[n]=await (await fetch(`demo/frames/${n}/times.json`)).json();
  MARKS[n]=await (await fetch(`demo/frames/${n}/marks.json`)).json()}
  buildCamera()};
// Küresel kamera: tüm kayıtların kadrajları video zamanına çevrilir
const VX=20,VY=575,VW=1040,VH=1060,CX=540,CY=VY+VH/2;
let CAM=[];
function rectToCam(r){ // [x,y,w,h] CSS -> {cx,cy,k}
  const k=clamp(Math.min(VW*.96/r[2],VH*.96/r[3]),1.0,2.45);
  let cx=r[0]+r[2]/2,cy=r[1]+r[3]/2;
  const hx=VW/(2*k),hy=VH/(2*k); // pencere ekranın dışına taşmasın
  cx=2*hx<430?clamp(cx,hx,430-hx):215;cy=2*hy<932?clamp(cy,hy,932-hy):466;
  return {cx,cy,k}}
function buildCamera(){
  CAM=[];
  for(const [n,c] of Object.entries(CLIPS)){
    for(const m of MARKS[n]){
      let s=mapInv(c,m.t);
      let tv=c.a+s;
      if(m.label==='tam')tv=c.a+.35; // her kayıt tam telefonla başlar
      else tv=c.a+Math.max(.35,s)-.3; // yakınlaşma, işlemin hemen öncesinde biter
      CAM.push({t:tv,cam:rectToCam(m.rect),label:m.label})}}
  CAM.sort((p,q)=>p.t-q.t)}
function camAt(t){
  if(!CAM.length)return {cx:215,cy:466,k:1.09};
  const FULLC={cx:215,cy:466,k:1.09};
  let prev={t:-1,cam:FULLC},next=null;
  for(const e of CAM){ if(e.t<=t)prev=e; else {next=e;break} }
  const e0=prev.cam;
  if(!next)return e0;
  const dur=.6,u=clamp((t-(next.t-dur))/dur);
  const k=eio(u);
  return {cx:lerp(e0.cx,next.cam.cx,k),cy:lerp(e0.cy,next.cam.cy,k),k:Math.exp(lerp(Math.log(e0.k),Math.log(next.cam.k),k))}}
function frameIndex(name,rt){const ts=TIMES[name];let lo=0,hi=ts.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(ts[m]<=rt)lo=m;else hi=m-1}return lo}
function activeClips(t){return Object.entries(CLIPS).filter(([n,c])=>t>=c.a-.3&&t<c.b+.3).map(([n,c])=>({n,c}))}
window.prepare=async t=>{
  need.clear();const wants=[];
  for(const {n,c} of activeClips(t)){
    const s=clamp(t-c.a,0,c.b-c.a);const rt=mapFwd(c,s);
    const i=frameIndex(n,rt),j=Math.min(i+1,TIMES[n].length-1);
    need.set(n,{i,j,w:0});
    for(const idx of new Set([i,j])){const key=n+':'+idx;
      if(!IMGS[key]){const im=new Image();im.src=`demo/frames/${n}/f${String(idx+1).padStart(4,'0')}.jpg`;wants.push(im.decode().then(()=>{IMGS[key]=im}).catch(()=>{}))}}}
  await Promise.all(wants);
  const keep=new Set();for(const [n,v] of need){keep.add(n+':'+v.i);keep.add(n+':'+v.j)}
  for(const k of Object.keys(IMGS))if(!keep.has(k))delete IMGS[k]};
function phone(t,a,b){
  const inK=eo(seg(t,a,a+.7)),outK=eo(seg(t,b-.5,b));
  if(inK*(1-outK)<=0)return;
  const cam=camAt(t);
  ctx.save();
  // görüntü penceresi
  rr(VX,VY,VW,VH,40);ctx.clip();
  const slide=(1-inK)*620+outK*700;
  ctx.translate(CX,CY+slide);ctx.scale(cam.k,cam.k);ctx.translate(-cam.cx,-cam.cy);
  // gövde (CSS px uzayında; 430x932 ekran)
  const bz=11,sw=430,sh=932;
  ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=60/cam.k;ctx.shadowOffsetY=24/cam.k;
  ctx.fillStyle='#071a26';rr(-bz,-bz,sw+bz*2,sh+bz*2,58);ctx.fill();ctx.shadowColor='transparent';
  const g=ctx.createLinearGradient(-bz,0,sw+bz,0);g.addColorStop(0,'#0f4259');g.addColorStop(.5,'#2a8ca3');g.addColorStop(1,'#0f4259');
  ctx.strokeStyle=g;ctx.lineWidth=2.4;rr(-bz+1,-bz+1,sw+bz*2-2,sh+bz*2-2,57);ctx.stroke();
  ctx.save();rr(0,0,sw,sh,46);ctx.clip();
  ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,sw,sh);
  for(const {n,c} of activeClips(t)){
    const v=need.get(n);if(!v)continue;
    const A=IMGS[n+':'+v.i],B=IMGS[n+':'+v.j];if(!A)continue;
    const first=n==='olcu';
    const alpha=(first?1:clamp(seg(t,c.a-.05,c.a+.25)))*(n==='tahsilat'?1:1-clamp(seg(t,c.b-.25,c.b+.05)));
    if(alpha<=0)continue;
    ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(A,0,0,sw,sh);
    if(B&&v.w>.02){ctx.globalAlpha=alpha*v.w;ctx.drawImage(B,0,0,sw,sh)}
    ctx.restore()}
  ctx.restore();
  ctx.restore();
  // pencere kenarı yalnızca yakın planda hafifçe belirir
  const edge=clamp((cam.k-1.3)/.6)*.55;
  if(edge>0){ctx.save();ctx.globalAlpha=edge*inK;ctx.strokeStyle=C.teal;ctx.lineWidth=3;rr(VX,VY,VW,VH,40);ctx.stroke();ctx.restore()}
}
function sceneScreens(t){
  title('Ölçülerinizi kaydedin.',t,7.2,11.6,400);title('Tekliflerinizi hazırlayın.',t,11.6,15.6,400);title('Siparişlerinizi takip edin.',t,15.6,18.8,400);
  stepBadge(1,t,7.2,11.6);stepBadge(2,t,11.6,15.6);stepBadge(3,t,15.6,18.8);
  phone(t,7.2,24.6);
  const inK=eo(seg(t,18.8,19.35)),outK=seg(t,24.2,24.6);
  if(inK>0){ctx.save();ctx.globalAlpha=inK*(1-outK);
    text('Randevularınız ve',W/2,370+(1-inK)*40,66,800,C.white);
    text('tahsilatlarınız da tek yerde.',W/2,452+(1-inK)*40,66,800,C.white);ctx.restore()}
  const ck=t<22.4?'Randevu':'Tahsilat';
  if(t>=19.2&&t<24.4){ctx.save();ctx.globalAlpha=eo(seg(t,19.2,19.6))*(1-seg(t,24.2,24.5));
    ctx.font=`800 34px ${FONT}`;const w=ctx.measureText(ck).width+64;ctx.fillStyle=C.teal;rr(W/2-w/2,486,w,60,30);ctx.fill();
    ctx.fillStyle=C.bg0;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ck,W/2,517);ctx.restore()}
}
// ---------- Kapanış ----------
function sceneClose(t){
  const a=24.6,lt=t-a;if(t<a)return;
  const inK=eo(seg(t,a,a+.5));
  ctx.save();ctx.globalAlpha=inK;
  const sz=250;
  if(logoReady){const s=lerp(.9,1,eo(seg(lt,0,.7)));ctx.save();ctx.translate(W/2,560);ctx.scale(s,s);ctx.drawImage(logo,-sz/2,-sz/2,sz,sz);ctx.restore()}
  rise('PerdePRO',W/2,830,148,800,C.white,t,a+.2,.6);
  const lk=eo(seg(t,a+.6,a+1.1));
  ctx.fillStyle=C.teal;rr(W/2-70*lk,870,140*lk,8,4);ctx.fill();
  rise('İşinizi düzenleyin.',W/2,990,72,700,C.white,t,a+.8,.6);
  rise('Takibi kolaylaştırın.',W/2,1085,72,700,C.teal,t,a+1.1,.6);
  rise('7 gün ücretsiz deneyin.',W/2,1190,58,800,C.white,t,a+1.4,.5);
  rise('Detaylar:',W/2,1282,42,600,C.mute,t,a+1.6,.5);
  const pk=eob(seg(t,a+1.7,a+2.3));
  if(pk>0){ctx.save();ctx.translate(W/2,1370);ctx.scale(pk,pk);
    ctx.font=`800 74px ${FONT}`;const tw=ctx.measureText('ozidijital.com').width+110;
    ctx.fillStyle=C.teal;rr(-tw/2,-62,tw,124,62);ctx.fill();
    text('ozidijital.com',0,26,74,800,C.bg0);ctx.restore()}
  rise('Ekranlar örnek verilerle gösterilmiştir.',W/2,1500,32,600,'#c6dde6',t,a+2.4,.5);
  ctx.restore()}
