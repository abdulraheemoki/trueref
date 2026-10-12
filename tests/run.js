const C=require("../public/core.js"),fs=require("fs");
const [file,style]=process.argv.slice(2);
const d=C.splitDocument(fs.readFileSync(file,"utf8"));
const r=C.check(d.essay,d.references,style||"harvard");
console.log(r.stats);
r.issues.forEach(i=>console.log("-",i.severity,i.type,"|",i.title,"|",i.detail.slice(0,100),i.context?"| ctx:"+i.context.match:"", i.refRaw?"| ref:"+i.refRaw.slice(0,45):""));
console.log("\nCITES:"); r.citations.forEach(c=>console.log(" ",c.kind, JSON.stringify(c.name), c.year, c.page?"p":"", c.ref?"OK":"--"));
