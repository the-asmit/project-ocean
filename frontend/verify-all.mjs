import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /Isosurface/ }).click()
await p.waitForTimeout(1000)
const audit = () => p.evaluate(() => {
  const { dataset, built, isoValue: ISO } = window.__oceanIso
  if (!built) return { empty: true }
  const { W,H,D,levelsReal:HR,valueMin:lo,valueMax:hi,depthLevels:L } = dataset.meta.volume
  const { spanX, spanZ } = dataset.map
  const rg = dataset.rg8
  const at=(i,j,k)=>{const o=((k*H+j)*W+i)*2; return rg[o+1]>=128 ? lo+(rg[o]/255)*(hi-lo) : null}
  const g=built.geometry, idx=g.index.array, pos=g.attributes.position.array, nrm=g.attributes.normal.array
  // 1. manifold + winding consistency
  const edge=new Map(); let degen=0, flipped=0
  for(let t=0;t<idx.length/3;t++){
    const a=idx[t*3],c=idx[t*3+1],d=idx[t*3+2]
    if(a===c||c===d||a===d){degen++;continue}
    for(const [u,v] of [[a,c],[c,d],[d,a]]){const k=u<v?`${u}_${v}`:`${v}_${u}`
      edge.set(k,(edge.get(k)||0)+1)}
    const x0=pos[a*3],y0=pos[a*3+1],z0=pos[a*3+2]
    const ux=pos[c*3]-x0,uy=pos[c*3+1]-y0,uz=pos[c*3+2]-z0
    const vx=pos[d*3]-x0,vy=pos[d*3+1]-y0,vz=pos[d*3+2]-z0
    const fx=uy*vz-uz*vy,fy=uz*vx-ux*vz,fz=ux*vy-uy*vx
    const nx=nrm[a*3]+nrm[c*3]+nrm[d*3],ny=nrm[a*3+1]+nrm[c*3+1]+nrm[d*3+1],nz=nrm[a*3+2]+nrm[c*3+2]+nrm[d*3+2]
    if(fx*nx+fy*ny+fz*nz<0)flipped++
  }
  const share={}; for(const v of edge.values())share[v]=(share[v]||0)+1
  // 2. resample every-Nth vertex through the SHARED CPU sampler
  const rs=[]; let invalid=0
  const step=Math.max(1,Math.floor(pos.length/3/500))
  for(let v=0;v<pos.length/3;v+=step){
    const s=dataset.sampler(pos[v*3],pos[v*3+1]/8,pos[v*3+2])
    if(s.value==null){invalid++;continue}
    rs.push(Math.abs(s.value-ISO))
  }
  rs.sort((a,c)=>a-c)
  // 3. depth vs ground-truth per-column isotherm depth
  const dep=new Float64Array(W*D).fill(NaN)
  for(let k=0;k<D;k++)for(let i=0;i<W;i++)
    for(let j=0;j<HR-1;j++){const a=at(i,j,k),c=at(i,j+1,k); if(a==null||c==null)break
      if((a-ISO)*(c-ISO)<=0&&a!==c){dep[k*W+i]=L[j]+((a-ISO)/(a-c))*(L[j+1]-L[j]);break}}
  const bil=(fi,fk)=>{const i0=Math.min(W-2,Math.floor(fi)),k0=Math.min(D-2,Math.floor(fk))
    const tx=fi-i0,tz=fk-k0;let s=0,w=0
    for(let dk=0;dk<2;dk++)for(let di=0;di<2;di++){const v=dep[(k0+dk)*W+i0+di]
      if(!Number.isFinite(v))continue;const wt=(di?tx:1-tx)*(dk?tz:1-tz);s+=v*wt;w+=wt}
    return w<0.5?NaN:s/w}
  const de=[]
  for(let v=0;v<pos.length/3;v++){
    const fi=(pos[v*3]/spanX+0.5)*(W-1),fk=(pos[v*3+2]/spanZ+0.5)*(D-1)
    const truth=bil(fi,fk); if(!Number.isFinite(truth))continue
    de.push(Math.abs(dataset.map.yToDepth(pos[v*3+1]/8)-truth))
  }
  de.sort((a,c)=>a-c)
  const q=(A,f)=>A[Math.floor(A.length*f)]
  return {
    iso: ISO, tris: built.triangles, verts: built.vertices, ms: +built.ms.toFixed(1),
    degenerate: degen, windingFlipped: flipped, edgeSharing: share,
    resampleMedC: +q(rs,.5).toFixed(4), resampleP99C: +q(rs,.99).toFixed(4), resampleInvalid: invalid,
    depthMedM: +q(de,.5).toFixed(3), depthP99M: +q(de,.99).toFixed(3), depthMaxM: +de[de.length-1].toFixed(2),
  }
})
for (const v of [14, 20, 26]) {
  await p.evaluate((val)=>{const el=document.querySelector('#sl-isovalue')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(val))
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}))}, v)
  await p.waitForTimeout(900)
  console.log(await audit())
}
await b.close()
