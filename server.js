const http = require("http");
const fs = require("fs");
const path = require("path");

// CONFIG
const FACILITY = { lat: 25.588830343561458, lng: 56.26589413996632, radius: 100 }; // increased radius
const WORK_START = "09:00";
const WORK_END = "17:00";
const LATE_AFTER = "09:05";
const EARLY_BEFORE = "17:00";

// HELPERS
const readJSON = (file, defaultData = []) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : defaultData;
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const toMinutes = time => { const [h,m]=time.split(":").map(Number); return h*60+m; };
const getDistance = (lat1,lng1,lat2,lng2) => {
  const R=6371000, toRad=v=>v*Math.PI/180, dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const PORT = process.env.PORT || 3000;

http.createServer((req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS"){ res.writeHead(204); return res.end(); }

  // ROOT
  if(req.method==="GET" && req.url==="/"){ res.writeHead(200); return res.end("Attendance Server Running"); }

  // REGISTER
  if(req.method==="POST" && req.url==="/auth/register"){
    let body=""; req.on("data",chunk=>body+=chunk); req.on("end",()=>{
      try{
        const data=JSON.parse(body);
        if(!data.name||!data.email||!data.password){ res.writeHead(400); return res.end(JSON.stringify({msg:"All fields required"})); }
        const users=readJSON("./users.json");
        if(users.find(u=>u.email===data.email)){ res.writeHead(409); return res.end(JSON.stringify({msg:"User exists"})); }
        users.push(data); writeJSON("./users.json",users);
        res.writeHead(200); res.end(JSON.stringify({msg:"Registered",data}));
      }catch{ res.writeHead(500); res.end(JSON.stringify({msg:"Server error"})); }
    });
    return;
  }

  // LOGIN
  if(req.method==="POST" && req.url==="/auth/login"){
    let body=""; req.on("data",chunk=>body+=chunk); req.on("end",()=>{
      try{
        const data=JSON.parse(body);
        if(!data.email||!data.password){ res.writeHead(400); return res.end(JSON.stringify({msg:"Email & password required"})); }
        const users=readJSON("./users.json");
        const user=users.find(u=>u.email===data.email && u.password===data.password);
        if(!user){ res.writeHead(404); return res.end(JSON.stringify({msg:"Invalid credentials"})); }
        res.writeHead(200); res.end(JSON.stringify({msg:"Login successful",data:user}));
      }catch{ res.writeHead(500); res.end(JSON.stringify({msg:"Server error"})); }
    });
    return;
  }

  // CHECK-IN / CHECK-OUT
  if(req.method==="POST" && (req.url==="/in"||req.url==="/out")){
    let body=""; req.on("data",chunk=>body+=chunk); req.on("end",()=>{
      try{
        const data=JSON.parse(body); const {name,type,date,now}=data; const lat=Number(data.lat); const lng=Number(data.lng);
        if(!name||!date||!now||isNaN(lat)||isNaN(lng)){ res.writeHead(400); return res.end(JSON.stringify({msg:"Invalid data"})); }
        const distance=getDistance(lat,lng,FACILITY.lat,FACILITY.lng);
        if(distance>FACILITY.radius){ res.writeHead(403); return res.end(JSON.stringify({msg:"Outside facility"})); }

        const records=readJSON("./attendance.json");
        const todayRecords=records.filter(r=>r.name===name && r.date===date);

        if(req.url==="/in" && todayRecords.some(r=>r.type==="in")){ res.writeHead(409); return res.end(JSON.stringify({msg:"Already checked in"})); }
        if(req.url==="/out" && !todayRecords.some(r=>r.type==="in")){ res.writeHead(409); return res.end(JSON.stringify({msg:"Check-in required first"})); }

        records.push({...data,lat,lng,distance:Math.round(distance)});
        writeJSON("./attendance.json",records);
        res.writeHead(200); res.end(JSON.stringify({msg:"Recorded",data:records}));
      }catch{ res.writeHead(500); res.end(JSON.stringify({msg:"Server error"})); }
    });
    return;
  }

  // DELETE FALSE RECORD
  if(req.method==="POST" && req.url==="/delete"){
    let body=""; req.on("data",chunk=>body+=chunk); req.on("end",()=>{
      try{
        const data=JSON.parse(body); // {name,date,type}
        if(!data.name||!data.date||!data.type){ res.writeHead(400); return res.end(JSON.stringify({msg:"Invalid data"})); }

        let records=readJSON("./attendance.json");
        const beforeCount=records.length;
        records=records.filter(r=>!(r.name===data.name && r.date===data.date && r.type===data.type));
        writeJSON("./attendance.json",records);

        // Update CSV
        const file=path.join(__dirname,"attendance_report.csv");
        const s=fs.createWriteStream(file);
        s.write("name,date,type,time,lat,lng\n");
        records.forEach(r=>s.write(`${r.name},${r.date},${r.type},${r.now},${r.lat},${r.lng}\n`));
        s.end();

        res.writeHead(200);
        res.end(JSON.stringify({msg:`Deleted ${beforeCount-records.length} record(s)`,data:records}));

      }catch{ res.writeHead(500); res.end(JSON.stringify({msg:"Server error"})); }
    });
    return;
  }

  // DAILY REPORT
  if(req.method==="GET" && req.url.startsWith("/report")){
    try{
      const records=readJSON("./attendance.json");
      const url=new URL(req.url, `http://${req.headers.host}`);
      const start=url.searchParams.get("start");
      const end=url.searchParams.get("end");
      let filtered=records; if(start) filtered=filtered.filter(r=>r.date>=start); if(end) filtered=filtered.filter(r=>r.date<=end);

      const file=path.join(__dirname,"attendance_report.csv");
      const s=fs.createWriteStream(file);
      s.write("name,date,type,time,lat,lng\n"); filtered.forEach(r=>s.write(`${r.name},${r.date},${r.type},${r.now},${r.lat},${r.lng}\n`));
      s.end(); s.on("finish",()=>{
        res.writeHead(200,{"Content-Type":"text/csv","Content-Disposition":"attachment; filename=attendance_report.csv"});
        fs.createReadStream(file).pipe(res);
      });

    }catch{ res.writeHead(500); res.end(JSON.stringify({msg:"Server error"})); }
    return;
  }

  // MONTHLY SUMMARY
  if(req.method==="GET" && req.url.startsWith("/summary")){
    try{
      const records=readJSON("./attendance.json");
      const url=new URL(req.url, `http://${req.headers.host}`);
      const month=url.searchParams.get("month");
      const summary={},daily={};
      records.forEach(r=>{ if(!r.date.startsWith(month)) return; const k=`${r.name}_${r.date}`; daily[k] ||= []; daily[k].push(r); });
      for(const k in daily){
        const d=daily[k]; const name=d[0].name; const inR=d.find(r=>r.type==="in"); const outR=d.find(r=>r.type==="out"); if(!inR||!outR) continue;
        summary[name] ||= {days:0,total_hours:0,late:0,early:0};
        const hrs=(new Date(`${d[0].date}T${outR.now}`)-new Date(`${d[0].date}T${inR.now}`))/36e5;
        summary[name].days++; summary[name].total_hours+=hrs;
        if(toMinutes(inR.now)>toMinutes(LATE_AFTER)) summary[name].late++;
        if(toMinutes(outR.now)<toMinutes(EARLY_BEFORE)) summary[name].early++;
      }
      res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify(summary,null,2));
    }catch{ res.writeHead(500); res.end(JSON.stringify({msg:"Server error"})); }
    return;
  }

  res.writeHead(404); res.end("Not found");

}).listen(PORT,()=>console.log(`🚀 Attendance server running on port ${PORT}`));
