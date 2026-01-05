const http = require("http");
const fs = require("fs");
const path = require("path");

// =====================
// Facility Config
// =====================
const FACILITY = {
  lat:25.588830343561458,
  lng: 56.26589413996632,
  radius: 10 // meters
};

// =====================
// Distance Calculation
// =====================
function getDistanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = v => (v * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =====================
// Server
// =====================
http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // =====================
  // DEFAULT
  // =====================
  if (req.method === "GET" && req.url === "/") {
    res.end("Attendance Server Running");
    return;
  }

  // =====================
  // REGISTER
  // =====================
  if (req.method === "POST" && req.url === "/auth/register") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (!data.name || !data.email || !data.password) {
          res.writeHead(400);
          return res.end(JSON.stringify({ msg: "All fields are required", code: 400 }));
        }

        let users = [];
        if (fs.existsSync("./empDB.json")) {
          users = JSON.parse(fs.readFileSync("./empDB.json"));
        }

        const exists = users.find(u => u.email === data.email);
        if (exists) {
          res.writeHead(400);
          return res.end(JSON.stringify({ msg: "User already exists", code: 400 }));
        }

        users.push(data);
        fs.writeFileSync("./empDB.json", JSON.stringify(users));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ msg: "Registered successfully", code: 200, data }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ msg: "Server error", code: 500 }));
      }
    });
    return;
  }

  // =====================
  // LOGIN
  // =====================
  if (req.method === "POST" && req.url === "/auth/login") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const loginInfo = JSON.parse(body);
        if (!loginInfo.email || !loginInfo.password) {
          res.writeHead(400);
          return res.end(JSON.stringify({ msg: "Email & password required", code: 400 }));
        }

        let users = [];
        if (fs.existsSync("./empDB.json")) {
          users = JSON.parse(fs.readFileSync("./empDB.json"));
        }

        const user = users.find(
          u => u.email === loginInfo.email && u.password === loginInfo.password
        );

        if (!user) {
          res.writeHead(404);
          return res.end(JSON.stringify({ msg: "User not registered", code: 404 }));
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ msg: "Login successful", code: 200, data: user }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ msg: "Server error", code: 500 }));
      }
    });
    return;
  }

  // =====================
  // CHECK-IN / CHECK-OUT
  // =====================
  if (req.method === "POST" && (req.url === "/in" || req.url === "/out")) {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        const { lat, lng, name } = data;
        if (!lat || !lng || !name) {
          res.writeHead(400);
          return res.end(JSON.stringify({ msg: "Missing required fields" }));
        }

        const distance = getDistanceInMeters(lat, lng, FACILITY.lat, FACILITY.lng);

        if (distance > FACILITY.radius) {
          res.writeHead(403);
          return res.end(JSON.stringify({ msg: "❌ Outside facility - access denied" }));
        }

        let records = [];
        if (fs.existsSync("./attendence.json")) {
          records = JSON.parse(fs.readFileSync("./attendence.json"));
        }

        records.push(data);
        fs.writeFileSync("./attendence.json", JSON.stringify(records));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          msg: req.url === "/in" ? "Check in ✅ Laboratory 🔬" : "Check out ✅ Go Home 🏡",
          data: records
        }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ msg: "Server error" }));
      }
    });
    return;
  }

  // =====================
  // REPORT
  // =====================
if (req.method === "GET" && req.url.startsWith("/report")) {
  try {
    let data = [];
    if (fs.existsSync("./attendence.json")) {
      data = JSON.parse(fs.readFileSync("./attendence.json"));
    }

    // =======================
    // Parse query parameters
    // =======================
    const url = new URL(req.url, `http://${req.headers.host}`);
    const start = url.searchParams.get("start"); // e.g., 2026-01-01
    const end = url.searchParams.get("end");     // e.g., 2026-01-02

    if (start || end) {
      data = data.filter(r => {
        const recordDate = r.date; // YYYY-MM-DD
        if (start && recordDate < start) return false;
        if (end && recordDate > end) return false;
        return true;
      });
    }

    const reportPath = path.join(__dirname, "main_report.csv");
    const stream = fs.createWriteStream(reportPath);
    stream.write("name,date,time,type,lat,lng\n");

    data.forEach(r => {
      stream.write(`${r.name},${r.date},${r.now},${r.type},${r.lat},${r.lng}\n`);
    });

    stream.end();
    stream.on("finish", () => {
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=attendance_report.csv"
      });
      fs.createReadStream(reportPath).pipe(res);
    });

  } catch {
    res.writeHead(500);
    res.end(JSON.stringify({ msg: "Server error" }));
  }
  return;
}


  // =====================
  // UNKNOWN ROUTE
  // =====================
  res.writeHead(404);
  res.end("Route not found");

}).listen(3000, () => {
  console.log("✅ Attendance server running on port 3000");
});




