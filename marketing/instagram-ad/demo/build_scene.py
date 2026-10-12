import os; D=os.path.dirname(os.path.abspath(__file__)); P=lambda *a: os.path.join(D,*a)
src = open(P('..','scene_v1.html'), encoding='utf-8').read()
new = open(P('scene_v3_part.js'), encoding='utf-8').read().replace('top=560,pad=22', 'top=610,pad=22')
head = src[:src.index('// ---------- S1/S2')]
closing = ''
closing = closing.replace(
    "rise('Takibi kolaylaştırın.',W/2,1085,72,700,C.teal,t,a+1.8,.7);",
    "rise('Takibi kolaylaştırın.',W/2,1085,72,700,C.teal,t,a+1.8,.7);\n  rise('Ekranlar örnek verilerle gösterilmiştir.',W/2,1520,26,500,C.mute,t,a+3.4,.6);")
s3 = src[src.index('// ---------- S3: faydalar'):src.index('function sceneMeasure')]
draw = """window.draw=function(t){
  ctx.clearRect(0,0,W,H);
  background(t);
  scene1(t);scene2(t);
  sceneScreens(t);sceneClose(t);
  const fi=1-seg(t,0,.35);if(fi>0){ctx.fillStyle=`rgba(4,32,47,${fi})`;ctx.fillRect(0,0,W,H)}
};
window.ready=()=>new Promise(r=>{const f=()=>document.fonts.ready.then(()=>logoReady?window.loadTimes().then(()=>r(true)):setTimeout(f,50));f()});
</script></body></html>
"""
open(P('..','scene.html'), 'w', encoding='utf-8').write(head + s3 + new + closing + draw)
print('ok', len(head), len(new), len(closing))
