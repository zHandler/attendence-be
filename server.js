const http = require("http");
const fs = require("fs");
const path = require("path");

// =====================
// CONFIG
// =====================
const FACILITY = {
  lat: 25.588830343561458,
  lng: 56.26589413996632,
  radius: 50
};

const WORK_START = "09:00";
const WORK_END = "17:00";
const LATE_AFTER = "09:05";
const EARLY_BEFORE = "17:00";

// =====================
// HELPERS
// =====================
const readJSON = (f, d = []) =>
  fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : d;

const writeJSON = (f, d) =>
  fs.writeFileSync(f, JSON.stringify(d, null, 2));

const toMinutes = t => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

function getDistance(lat1, lng1, lat2, lng2) {
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
// SERVER
// =====================
http.createServer((req, res) => {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // =====================
  // CHECK-IN / CHECK-OUT
  // =====================
  if (req.method === "POST" && (req.url === "/in" || req.url === "/out")) {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const { name, type, date, now } = data;

        const lat = Number(data.lat);
        const lng = Number(data.lng);

        if (!name || !date || !now || isNaN(lat) || isNaN(lng)) {
          res.writeHead(400);
          return res.end(JSON.stringify({ msg: "Invalid data" }));
        }

        const distance = getDistance(lat, lng, FACILITY.lat, FACILITY.lng);
        if (distance > FACILITY.radius) {
          res.writeHead(403);
          return res.end(JSON.stringify({ msg: "Outside facility" }));
        }

        const records = readJSON("./attendance.json");

        const todayRecords = records.filter(
          r => r.name === name && r.date === date
        );

        // ❌ Prevent double check-in
        if (req.url === "/in" && todayRecords.some(r => r.type === "in")) {
          res.writeHead(409);
          return res.end(JSON.stringify({ msg: "Already checked in" }));
        }

        // ❌ Prevent check-out without check-in
        if (req.url === "/out" && !todayRecords.some(r => r.type === "in")) {
          res.writeHead(409);
          return res.end(JSON.stringify({ msg: "Check-in required first" }));
        }

        records.push({
          ...data,
          lat,
          lng,
          distance: Math.round(distance)
        });

        writeJSON("./attendance.json", records);

        res.writeHead(200);
        res.end(JSON.stringify({ msg: "Recorded successfully", data: records }));

      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ msg: "Server error" }));
      }
    });
    return;
  }

  // =====================
  // REPORT (DAILY)
  // =====================
  if (req.method === "GET" && req.url.startsWith("/report")) {
    try {
      const records = readJSON("./attendance.json");
      const url = new URL(req.url, `http://${req.headers.host}`);
      const month = url.searchParams.get("month"); // YYYY-MM

      const grouped = {};

      records.forEach(r => {
        if (month && !r.date.startsWith(month)) return;
        const key = `${r.name}_${r.date}`;
        grouped[key] ||= [];
        grouped[key].push(r);
      });

      const report = [];

      for (const k in grouped) {
        const day = grouped[k];
        const name = day[0].name;
        const date = day[0].date;

        const checkIn = day.find(r => r.type === "in");
        const checkOut = day.find(r => r.type === "out");

        let hours = 0;
        if (checkIn && checkOut) {
          const start = new Date(`${date}T${checkIn.now}`);
          const end = new Date(`${date}T${checkOut.now}`);
          hours = ((end - start) / 36e5).toFixed(2);
        }

        const late = checkIn && toMinutes(checkIn.now) > toMinutes(LATE_AFTER);
        const early = checkOut && toMinutes(checkOut.now) < toMinutes(EARLY_BEFORE);

        report.push({
          name,
          date,
          check_in: checkIn?.now || "",
          check_out: checkOut?.now || "",
          working_hours: hours,
          late: late ? "YES" : "NO",
          early_leave: early ? "YES" : "NO"
        });
      }

      const file = path.join(__dirname, "attendance_report.csv");
      const s = fs.createWriteStream(file);

      s.write("name,date,check_in,check_out,working_hours,late,early_leave\n");
      report.forEach(r => {
        s.write(
          `${r.name},${r.date},${r.check_in},${r.check_out},${r.working_hours},${r.late},${r.early_leave}\n`
        );
      });

      s.end();
      s.on("finish", () => {
        res.writeHead(200, {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=attendance_report.csv"
        });
        fs.createReadStream(file).pipe(res);
      });

    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ msg: "Server error" }));
    }
    return;
  }

  // =====================
  // MONTHLY SUMMARY
  // =====================
  if (req.method === "GET" && req.url.startsWith("/summary")) {
    try {
      const records = readJSON("./attendance.json");
      const url = new URL(req.url, `http://${req.headers.host}`);
      const month = url.searchParams.get("month");

      const summary = {};

      records.forEach(r => {
        if (!r.date.startsWith(month)) return;
        summary[r.name] ||= {
          days: 0,
          total_hours: 0,
          late: 0,
          early: 0
        };
      });

      const daily = {};

      records.forEach(r => {
        if (!r.date.startsWith(month)) return;
        const key = `${r.name}_${r.date}`;
        daily[key] ||= [];
        daily[key].push(r);
      });

      for (const k in daily) {
        const d = daily[k];
        const name = d[0].name;

        const inR = d.find(r => r.type === "in");
        const outR = d.find(r => r.type === "out");

        if (!inR || !outR) continue;

        const start = new Date(`${d[0].date}T${inR.now}`);
        const end = new Date(`${d[0].date}T${outR.now}`);
        const hrs = (end - start) / 36e5;

        summary[name].days++;
        summary[name].total_hours += hrs;

        if (toMinutes(inR.now) > toMinutes(LATE_AFTER)) summary[name].late++;
        if (toMinutes(outR.now) < toMinutes(EARLY_BEFORE)) summary[name].early++;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary, null, 2));

    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ msg: "Server error" }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");

}).listen(3000, () => {
  console.log("🚀 Attendance system running on port 3000");
});

