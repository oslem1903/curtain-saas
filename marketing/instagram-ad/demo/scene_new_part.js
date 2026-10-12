// ---------- S1/S2: dağınık notlar -> düzen ----------
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
function tape(t,alpha){ // ölçü şeridi
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
function scene1(t){ // 0-8
  const out=1-seg(t,7.4,8.0);
  if(out<=0)return;
  ctx.save();ctx.globalAlpha=out;
  const calm=1-seg(t,3.6,4.2);
  NOTES.forEach((n,i)=>{
    const wob=Math.sin(t*2.2+n.ph)*.07*calm;
    let x=n.x+Math.sin(t*1.1+n.ph)*26*calm,y=n.y+Math.cos(t*.9+n.ph)*20*calm,rot=n.rot+wob,s=1,a=1,tidy=false;
    const enter=eo(seg(t,.05+i*.08,.5+i*.08));
    x=lerp(n.side*700+W/2,x,enter);y=y+(1-enter)*260;a=enter;rot+=(1-enter)*n.side*.8;s=lerp(.75,1,enter);
    const k=eio(seg(t,3.7,4.7));
    if(k>0){
      let tx=W/2,ty=1060,tr=0,ts=.25;
      if(i<6){const [cx,cy]=TILE[i];tx=W/2+(cx-1)*270;ty=1390+cy*150;tr=0;ts=.58;tidy=k>.5}
      x=lerp(x,tx,k);y=lerp(y,ty,k);rot=lerp(rot,tr,k);s=lerp(s,ts,k);
      if(i>=6)a*=1-seg(t,4.2,4.8)}
    drawNote(n,x,y,rot,s,a,tidy)});
  ctx.restore();
  const o=1-seg(t,3.3,3.8);
  if(o>0){
    ctx.save();ctx.globalAlpha=o;tape(t,1);
    warnTag('Ölçü kayıp mı?',300,1000,-.12,t,1.1,1);
    warnTag('Tahsilat unutuldu mu?',760,1210,.1,t,2.2,1);
    ctx.restore();
    ctx.save();ctx.globalAlpha=o;
    const gr=ctx.createLinearGradient(0,250,0,850);gr.addColorStop(0,'rgba(4,32,47,.0)');gr.addColorStop(.25,'rgba(4,32,47,.82)');gr.addColorStop(.8,'rgba(4,32,47,.82)');gr.addColorStop(1,'rgba(4,32,47,0)');
    ctx.fillStyle=gr;ctx.fillRect(0,250,W,600);
    const kk=eo(seg(t,.1,.6));
    ctx.save();ctx.globalAlpha*=kk;ctx.font=`800 34px ${FONT}`;const lab='PERDECİLER İÇİN';const lw=ctx.measureText(lab).width+64;
    ctx.fillStyle=C.teal;rr(W/2-lw/2,300,lw,64,32);ctx.fill();ctx.fillStyle=C.bg0;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(lab,W/2,334);ctx.restore();
    rise('Ölçüler, teklifler,',W/2,480,88,800,C.white,t,.35,.7);
    rise('siparişler…',W/2,585,88,800,C.white,t,.65,.7);
    rise('Hepsi ayrı yerde mi?',W/2,725,70,700,C.teal,t,1.8,.7);
    ctx.restore()}
}
function scene2(t){ // 4-8
  const k=seg(t,4.5,5.3);if(k<=0)return;
  const out=1-seg(t,7.5,8.0);
  ctx.save();ctx.globalAlpha=out;
  const ring=seg(t,4.4,5.4);ctx.save();ctx.globalAlpha*=(1-ring)*.8;ctx.strokeStyle=C.teal;ctx.lineWidth=8;
  ctx.beginPath();ctx.arc(W/2,640,120+ring*520,0,6.283);ctx.stroke();ctx.restore();
  const s=eob(k);const sz=360;
  if(logoReady){ctx.save();ctx.translate(W/2,640);ctx.scale(s,s);ctx.globalAlpha*=eo(seg(t,4.5,4.9));
    ctx.drawImage(logo,-sz/2,-sz/2,sz,sz);ctx.restore()}
  rise('PerdePRO',W/2,1010,140,800,C.white,t,5.1,.7);
  rise('Perde işiniz tek yerde.',W/2,1130,62,600,C.teal,t,5.6,.7);
  ctx.restore()}

// ---------- Gerçek uygulama ekranları (yerel demo kaydı, örnek veri) ----------
const CLIPS={
  olcu:{rec0:0.9,speed:2.3,fx:.5,fy:.3,z0:1.0,z1:1.14},
  teklif:{rec0:.9,speed:1.0,fx:.5,fy:.25,z0:1.0,z1:1.12},
  siparis:{rec0:.9,speed:1.0,fx:.5,fy:.25,z0:1.0,z1:1.12},
  randevu:{rec0:.9,speed:.95,fx:.5,fy:.25,z0:1.0,z1:1.12},
  tahsilat:{rec0:.2,speed:.8,fx:.5,fy:.25,z0:1.0,z1:1.1},
};
const SPANS=[['olcu',8.0,11.4],['teklif',11.4,14.8],['siparis',14.8,18.2],['randevu',18.0,20.6],['tahsilat',20.6,23.1]];
const TIMES={};const IMGS={};const need=new Map();
window.loadTimes=async()=>{for(const n of Object.keys(CLIPS)){TIMES[n]=await (await fetch(`demo/frames/${n}/times.json`)).json()}};
function frameIndex(name,rt){const ts=TIMES[name];let lo=0,hi=ts.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(ts[m]<=rt)lo=m;else hi=m-1}return lo}
function active(t){return SPANS.filter(([n,a,b])=>t>=a-.3&&t<b+.3).map(([n,a,b])=>({n,a,b}))}
window.prepare=async t=>{
  need.clear();const wants=[];
  for(const {n,a,b} of active(t)){const c=CLIPS[n];const rt=c.rec0+(Math.max(a,Math.min(b,t))-a)*c.speed;
    const i=frameIndex(n,Math.max(0,rt));need.set(n,i);const key=n+':'+i;
    if(!IMGS[key]){const im=new Image();im.src=`demo/frames/${n}/f${String(i+1).padStart(4,'0')}.jpg`;wants.push(im.decode().then(()=>{IMGS[key]=im}).catch(()=>{}))}}
  await Promise.all(wants);
  const keep=new Set([...need].map(([n,i])=>n+':'+i));for(const k of Object.keys(IMGS))if(!keep.has(k))delete IMGS[k]};
function phone(t,a,b){
  const inK=eo(seg(t,a,a+.7)),outK=eo(seg(t,b-.5,b));
  if(inK*(1-outK)<=0)return;
  const bx=140,bw=800,top=560,pad=22,sx=bx+pad,sw=bw-pad*2,sy=top+pad;
  const dy=(1-inK)*420+outK*520;
  ctx.save();ctx.translate(0,dy);
  ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=70;ctx.shadowOffsetY=30;
  const g=ctx.createLinearGradient(bx,0,bx+bw,0);g.addColorStop(0,'#0f4259');g.addColorStop(.5,'#1d6f86');g.addColorStop(1,'#0f4259');
  ctx.fillStyle='#071a26';rr(bx,top,bw,1500,78);ctx.fill();ctx.shadowColor='transparent';
  ctx.strokeStyle=g;ctx.lineWidth=5;rr(bx+1,top+1,bw-2,1500,78);ctx.stroke();
  ctx.save();rr(sx,sy,sw,1500,58);ctx.clip();
  ctx.fillStyle='#f8fafc';ctx.fillRect(sx,sy,sw,1500);
  const scale=sw/860,cropTop=74;
  for(const {n,a:ca,b:cb} of active(t)){
    const c=CLIPS[n];const im=IMGS[n+':'+need.get(n)];if(!im)continue;
    let alpha=(n==='olcu'?1:clamp(seg(t,ca,ca+.22)))*(1-clamp(seg(t,cb-.22,cb)));
    if(alpha<=0)continue;
    const z=lerp(c.z0,c.z1,eio(seg(t,ca,cb)));
    ctx.save();ctx.globalAlpha=alpha;
    const fx=sx+sw*c.fx,fy=sy+1500*c.fy*.5;
    ctx.translate(fx,fy);ctx.scale(z,z);ctx.translate(-fx,-fy);
    ctx.drawImage(im,0,cropTop,860,1864-cropTop,sx,sy,sw,(1864-cropTop)*scale);
    ctx.restore()}
  ctx.restore();ctx.restore()}
function sceneScreens(t){
  title('Ölçülerinizi kaydedin.',t,8.0,11.4,400);title('Tekliflerinizi hazırlayın.',t,11.4,14.8,400);title('Siparişlerinizi takip edin.',t,14.8,18.2,400);
  stepBadge(1,t,8.0,11.4);stepBadge(2,t,11.4,14.8);stepBadge(3,t,14.8,18.2);
  const note=eo(seg(t,8.3,8.9))*(1-seg(t,17.9,18.3));
  if(note>0){ctx.save();ctx.globalAlpha=note*.9;text('Gerçek PerdePRO ekranı · örnek verilerle',W/2,478,28,600,C.mute);ctx.restore()}
  phone(t,8.0,23.0);
  const inK=eo(seg(t,18.0,18.55)),outK=seg(t,22.6,23.0);
  if(inK>0){ctx.save();ctx.globalAlpha=inK*(1-outK);
    text('Randevularınız ve',W/2,370+(1-inK)*40,66,800,C.white);
    text('tahsilatlarınız da tek yerde.',W/2,452+(1-inK)*40,66,800,C.white);ctx.restore()}
  const ck=t<20.6?'Randevu':'Tahsilat';
  if(t>=18.5&&t<22.9){ctx.save();ctx.globalAlpha=eo(seg(t,18.5,19.0))*(1-seg(t,22.6,22.9));
    ctx.font=`800 34px ${FONT}`;const w=ctx.measureText(ck).width+64;ctx.fillStyle=C.teal;rr(W/2-w/2,500,w,60,30);ctx.fill();
    ctx.fillStyle=C.bg0;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ck,W/2,531);ctx.restore()}
}
