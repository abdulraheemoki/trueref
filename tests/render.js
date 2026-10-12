const CSL=require("../node_modules/citeproc/citeproc_commonjs.js"),C=require("../public/core.js"),fs=require("fs");
const locales={"en-GB":fs.readFileSync("public/csl/locales-en-GB.xml","utf8"),"en-US":fs.readFileSync("public/csl/locales-en-US.xml","utf8")};
function toCSL(p,id){const o={id,type:p.type};["author","editor","title","container-title","volume","issue","page","publisher","publisher-place","DOI","URL","edition","issued","accessed"].forEach(k=>{if(p[k]!==undefined&&p[k]!=="")o[k]=p[k]});return o}
const d=C.splitDocument(fs.readFileSync(process.argv[2],"utf8"));
const items={};C.splitReferenceList(d.references).forEach((e,i)=>items["r"+i]=toCSL(C.parseEntry(e),"r"+i));
for(const st of ["harvard-cite-them-right","apa","chicago-author-date","modern-language-association","ieee","vancouver"]){
 const eng=new CSL.Engine({retrieveLocale:l=>locales[l]||locales["en-US"],retrieveItem:id=>items[id]},fs.readFileSync("public/csl/"+st+".csl","utf8"),st.startsWith("harvard")?"en-GB":"en-US");
 eng.setOutputFormat("text"); eng.updateItems(Object.keys(items)); const b=eng.makeBibliography();
 console.log("\n=== "+st); b[1].slice(0,4).forEach(x=>console.log(x.trim()));
 console.log("cite:",eng.makeCitationCluster([{id:"r1"}]));
}
