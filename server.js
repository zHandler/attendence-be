// importing the module HTTP
const app = require("http");
const fs = require("fs");
const path = require("path");


// creating the server
const http = app.createServer((request, response) => {

    // create header
    // ✅ CORS HEADERS
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // ✅ Handle preflight request
    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }
    if (request.method == "GET" && request.url == "/") {

        response.write("welcome to Attendence app")
        response.end()
    }
    else if (request.method == "POST" && request.url == "/auth/register") {
        let bodyData = "";
        request.on("data", (chunk) => { bodyData += chunk });
        request.on("end", () => {
            try {
                bodyData = JSON.parse(bodyData)
                // read old users
                const users = JSON.parse(fs.readFileSync("./empDB.json"))
                // push new
                users.push(bodyData)
                // store all
                const store = fs.writeFileSync("./empDB.json", JSON.stringify(users))
                response.writeHead(200, { "content-type": "application/json" })

                response.end(JSON.stringify({ bodyData, code: 200, msg: "registered successfully" }))

            } catch (error) {
                response.writeHead(400)

                response.end(JSON.stringify({ bodyData, code: 400, msg: "registered failed" }))
            }
        }
        )

    }
    else if (request.method == "POST" && request.url == "/auth/login") {

        let loginInfo = "";
        request.on("data", (chunk) => loginInfo += chunk)
        request.on("end", () => {
            loginInfo = JSON.parse(loginInfo)
            const read_db = JSON.parse(fs.readFileSync("./empDB.json"))
            console.log(loginInfo)
            const isExist = read_db.find(element => {


                return element.email == loginInfo.email && element.password == loginInfo.password
            });

            if (!isExist) {
                response.writeHead(404, { "Content-Type": "application/json" })
                return response.end(JSON.stringify({ msg: "user not registered ", code: 404 }))
            }
            response.end(JSON.stringify({ msg: "welcome back ", code: 200, data: isExist }))
        })

    }
    else if (request.method == "GET" && request.url == "/report") {
        // read DB
        const data = JSON.parse(fs.readFileSync("./attendence.json"))

        const report = path.join(__dirname, "main_report.csv")
        // create main columns
        const stream = fs.createWriteStream(report)
        stream.write('name,date,time,type\n')

        // create csv 
        data.forEach(element => {
            stream.write(`${element.name},${element.date},${element.now},${element.type}\n`)

        });
        stream.end()
        stream.on("finish", () => {
            response.writeHead(200, {
                "Content-Type": "text/csv",
                "Content-Disposition": "attachment; filename=attendance_report.csv"
            });

            // Send file
            fs.createReadStream(report).pipe(response);
        });

    }

    else if (request.method == "POST" && request.url == "/in") {
        let checkin_info = ""
        request.on("data", (chunk) => {
            checkin_info += chunk
        })
        request.on("end", () => {
            checkin_info = JSON.parse(checkin_info)
            console.log({ checkin_info })
            // read DB
            const old_checkin = JSON.parse(fs.readFileSync("./attendence.json"))

            old_checkin.push(checkin_info)

            const checkin = fs.writeFileSync("./attendence.json", JSON.stringify(old_checkin))

            response.writeHead(200,{ "Content-Type": "application/json" })
            response.write(JSON.stringify({ msg: "Check in ✅ Laboratory 🔬🧪🥼" }));
            response.end()

        })

    }
    else if (request.method == "POST" && request.url == "/out") {
        let checkin_info = ""
        request.on("data", (chunk) => {
            checkin_info += chunk
        })
        request.on("end", () => {
            checkin_info = JSON.parse(checkin_info)
            console.log({ checkin_info })
            // read DB
            const old_checkin = JSON.parse(fs.readFileSync("./attendence.json"))

            old_checkin.push(checkin_info)

            const checkin = fs.writeFileSync("./attendence.json", JSON.stringify(old_checkin))


            response.writeHead(200,{ "Content-Type": "application/json" })
            response.write(JSON.stringify({ msg: "Check out ✅ Go Home" }));
            response.end()

        })

    }
    // listening on specific port
}).listen(3000, () => { console.log("http server is running") })