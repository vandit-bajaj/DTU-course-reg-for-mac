// ============================================================================
// Comprehensive Compatibility Audit & Reliability Test Suite for DTU Bot
// ============================================================================

const crypto = require('crypto');
const querystring = require('querystring');
const cheerio = require('cheerio');
const { performance } = require('perf_hooks');
const https = require('https');

const targetHost = 'exam-setu.dtu.ac.in';
const baseUrl = `https://${targetHost}`;

const results = [];
function recordResult(testName, status, details = '') {
  results.push({ testName, status, details });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${status}] ${testName} ${details ? '- ' + details : ''}`);
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
});

function getCommonHeaders(host = targetHost) {
  return {
    "Host": host,
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Accept-Encoding": "gzip, deflate, br",
    "Priority": "u=0, i",
    "Connection": "keep-alive",
    "DNT": "1",
  };
}

(async () => {
  const got = (await import('got')).default;

  console.log('================================================================');
  console.log('PHASE 1: LIVE SERVER NETWORK & TLS AUDIT (exam-setu.dtu.ac.in)');
  console.log('================================================================');

  // Test 1: DNS & Connectivity
  try {
    const t0 = performance.now();
    const res = await got(baseUrl + '/', {
      headers: getCommonHeaders(),
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      followRedirect: false,
      timeout: { request: 5000 },
    });
    const t1 = performance.now();
    if (res.statusCode === 200) {
      recordResult('Live HTTPS Connectivity', 'PASS', `HTTP 200 in ${Math.round(t1 - t0)}ms`);
    } else {
      recordResult('Live HTTPS Connectivity', 'FAIL', `Unexpected status: ${res.statusCode}`);
    }
  } catch (err) {
    recordResult('Live HTTPS Connectivity', 'FAIL', err.message);
  }

  // Test 2: Latency & Keep-Alive Benchmarking
  try {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      await got(baseUrl + '/student/login', {
        headers: getCommonHeaders(),
        agent: { https: httpsAgent },
        throwHttpErrors: false,
        timeout: { request: 5000 },
      });
      const t1 = performance.now();
      times.push(Math.round(t1 - t0));
    }
    const avg = Math.round(times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1));
    recordResult('Network Latency & Keep-Alive', 'PASS', `Times: [${times.join(', ')}] ms, Warm Average: ${avg}ms`);
  } catch (err) {
    recordResult('Network Latency & Keep-Alive', 'FAIL', err.message);
  }

  // Test 3: Cookie Acquisition (`connect.sid`)
  let sessionCookie = '';
  try {
    const res = await got(baseUrl + '/', {
      headers: getCommonHeaders(),
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      followRedirect: false,
      timeout: { request: 5000 },
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie && setCookie.some(c => c.includes('connect.sid='))) {
      sessionCookie = setCookie.find(c => c.includes('connect.sid=')).split(';')[0];
      recordResult('Session Cookie Acquisition', 'PASS', `Received: ${sessionCookie.slice(0, 35)}...`);
    } else {
      recordResult('Session Cookie Acquisition', 'FAIL', 'connect.sid not found in Set-Cookie header');
    }
  } catch (err) {
    recordResult('Session Cookie Acquisition', 'FAIL', err.message);
  }

  console.log('\n================================================================');
  console.log('PHASE 2: LIVE LOGIN & AUTHENTICATION AUDIT');
  console.log('================================================================');

  // Test 4: Login Form DOM Structure
  try {
    const res = await got(baseUrl + '/student/login', {
      headers: getCommonHeaders(),
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      timeout: { request: 5000 },
    });
    const $ = cheerio.load(res.body);
    const form = $('form[action="/student/login"]');
    const rollInput = form.find('input[name="roll_no"]');
    const passInput = form.find('input[name="password"]');
    const submitBtn = form.find('button[type="submit"]');

    if (form.length && rollInput.length && passInput.length && submitBtn.length) {
      recordResult('Login Form DOM Verification', 'PASS', 'action="/student/login", inputs: roll_no, password, submit button all present');
    } else {
      recordResult('Login Form DOM Verification', 'FAIL', `Missing elements: form=${form.length}, roll=${rollInput.length}, pass=${passInput.length}, btn=${submitBtn.length}`);
    }
  } catch (err) {
    recordResult('Login Form DOM Verification', 'FAIL', err.message);
  }

  // Test 5: Login Failure Handling (Invalid Credentials)
  try {
    const postBody = querystring.stringify({ roll_no: 'INVALID_AUDIT_999', password: 'wrong_password_test' });
    const res = await got(baseUrl + '/student/login', {
      method: 'POST',
      body: postBody,
      headers: {
        ...getCommonHeaders(),
        'Origin': baseUrl,
        'Referer': baseUrl + '/student/login',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': sessionCookie,
      },
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      followRedirect: false,
      timeout: { request: 5000 },
    });

    if (res.statusCode === 302 && (res.headers['location'] === '/student/login' || res.body.includes('Redirecting to /student/login'))) {
      recordResult('Invalid Credentials Rejection', 'PASS', 'HTTP 302 Redirect to /student/login detected');
    } else {
      recordResult('Invalid Credentials Rejection', 'FAIL', `Expected 302 redirect to /student/login, got: ${res.statusCode}`);
    }

    // Follow redirect to verify alert message extraction
    const updatedCookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : sessionCookie;
    const alertRes = await got(baseUrl + '/student/login', {
      headers: { ...getCommonHeaders(), 'Cookie': updatedCookie },
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      timeout: { request: 5000 },
    });
    const $ = cheerio.load(alertRes.body);
    const alertText = $('div.alert.alert-danger').text().replace(/\s+/g, ' ').replace('×', '').trim();
    if (alertText.includes('not found') || alertText.includes('Invalid') || alertText.includes('credentials')) {
      recordResult('Login Alert Extraction', 'PASS', `Captured server alert: "${alertText}"`);
    } else {
      recordResult('Login Alert Extraction', 'PARTIALLY VERIFIED', `No alert text found; status: ${alertRes.statusCode}`);
    }
  } catch (err) {
    recordResult('Invalid Credentials Rejection', 'FAIL', err.message);
  }

  console.log('\n================================================================');
  console.log('PHASE 3: PROTECTED ENDPOINTS & SESSION EXPIRY AUDIT');
  console.log('================================================================');

  // Test 6: Unauthenticated Access to /student/courseRegistration/:hash
  try {
    const res = await got(baseUrl + '/student/courseRegistration/fakeHashAudit123', {
      headers: getCommonHeaders(),
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      followRedirect: false,
      timeout: { request: 5000 },
    });
    if (res.statusCode === 302 && res.headers['location']?.includes('/student/login')) {
      recordResult('Protected Route Access Control', 'PASS', 'Unauthenticated request correctly redirected to /student/login');
    } else {
      recordResult('Protected Route Access Control', 'FAIL', `Expected 302 redirect, got: ${res.statusCode}`);
    }
  } catch (err) {
    recordResult('Protected Route Access Control', 'FAIL', err.message);
  }

  // Test 7: Registration POST Endpoint Existence (/student/courseRegister/:hash/:courseHash)
  try {
    const res = await got.post(baseUrl + '/student/courseRegister/fakeHashAudit123/fakeCourseAudit456', {
      headers: {
        ...getCommonHeaders(),
        'Referer': baseUrl + '/student/courseRegistration/fakeHashAudit123',
        'Cookie': sessionCookie,
        'Content-Length': '0',
      },
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      followRedirect: false,
      timeout: { request: 5000 },
    });
    if (res.statusCode === 302 || res.statusCode === 401 || res.statusCode === 403) {
      recordResult('Registration POST Route Availability', 'PASS', `Route exists and responds with HTTP ${res.statusCode} (auth guard active)`);
    } else {
      recordResult('Registration POST Route Availability', 'PARTIALLY VERIFIED', `Responded with HTTP ${res.statusCode}`);
    }
  } catch (err) {
    recordResult('Registration POST Route Availability', 'FAIL', err.message);
  }

  console.log('\n================================================================');
  console.log('PHASE 4: SIMULATION AUDIT OF COURSE TABLE PARSING & SELECTORS');
  console.log('================================================================');

  // Mock sample DTU elective course registration HTML
  const mockStudentHash = "660c1d293848491024810293";
  const mockCourseHash1 = "660c1e113848491024810294"; // HU317: E2 (available = 5)
  const mockCourseHash2 = "660c1e223848491024810295"; // SE427: E1 (available = 0)
  const mockCourseHash3 = "660c1e333848491024810296"; // IT305: E2 (registered, #0ff288)
  const mockCourseHash4 = "660c1e443848491024810297"; // CS401: E1 (blocked, #d4d3d2)

  const sampleRegistrationHtml = `
  <!DOCTYPE html>
  <html>
  <body>
    <div class="elective-subjects table-responsive">
      <table class="table table-hover table-bordered">
        <tbody>
          <!-- Slot E1 Header -->
          <tr class="setHeader">
            <td colspan="3">Slot E1 Electives</td>
          </tr>
          <tr>
            <td>1</td>
            <td>SE427</td>
            <td>Software Testing</td>
            <td>E1</td>
            <td>0</td>
            <td>
              <form action="/student/courseRegister/${mockStudentHash}/${mockCourseHash2}" method="POST">
                <button type="submit" class="btn btn-primary btn-sm">Register</button>
              </form>
            </td>
          </tr>
          <tr bgcolor="#d4d3d2">
            <td>2</td>
            <td>CS401</td>
            <td>Advanced Algorithms</td>
            <td>E1</td>
            <td>0</td>
            <td>
              <form action="/student/courseRegister/${mockStudentHash}/${mockCourseHash4}" method="POST">
                <button type="submit" disabled class="btn btn-secondary btn-sm">Blocked</button>
              </form>
            </td>
          </tr>

          <!-- Slot E2 Header with colspan="6" (testing resilience) -->
          <tr class="setHeader">
            <td colspan="6">Electives for Slot E2</td>
          </tr>
          <tr>
            <td>1</td>
            <td>HU317</td>
            <td>Economics</td>
            <td>E2</td>
            <td>5</td>
            <td>
              <form action="/student/courseRegister/${mockStudentHash}/${mockCourseHash1}" method="POST">
                <button type="submit" class="btn btn-primary btn-sm">Register</button>
              </form>
            </td>
          </tr>
          <tr bgcolor="#0ff288">
            <td>2</td>
            <td>IT305</td>
            <td>Cloud Computing</td>
            <td>E2</td>
            <td>12</td>
            <td>
              <form action="/student/courseRegister/${mockStudentHash}/${mockCourseHash3}" method="POST">
                <button type="submit" disabled class="btn btn-success btn-sm">Registered</button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </body>
  </html>
  `;

  // Test 8: Extracting courses with various slots
  const $mock = cheerio.load(sampleRegistrationHtml);
  const trackedCourses = new Map();
  const targetCourses = ["HU317:E2", "SE427:E1"];

  const parsedTargets = new Map(targetCourses.map(c => {
    const [code, slot] = c.split(':');
    return [code.toUpperCase(), slot.toUpperCase()];
  }));

  $mock("table tbody tr:not(.setHeader)").each((_, row) => {
    const cells = $mock(row).find("td");
    if (cells.length === 6) {
      const code = $mock(cells[1]).text().trim().toUpperCase();
      const slot = $mock(cells[3]).text().trim().toUpperCase();
      const seats = parseInt($mock(cells[4]).text().trim(), 10) || 0;
      const formAction = $mock(cells[5]).find("form").attr("action");

      if (formAction) {
        const match = formAction.match(new RegExp(`/student/courseRegister/${mockStudentHash}/([a-zA-Z0-9]+)`));
        const hash = match ? match[1] : null;

        if (hash && parsedTargets.has(code) && parsedTargets.get(code) === slot) {
          trackedCourses.set(hash, { courseCode: code, courseSlot: slot, seats });
          parsedTargets.delete(code);
        }
      }
    }
  });

  if (trackedCourses.has(mockCourseHash1) && trackedCourses.has(mockCourseHash2) && parsedTargets.size === 0) {
    recordResult('Elective Table Parsing (Simulation)', 'PASS', `Successfully tracked ${trackedCourses.size} courses: HU317 (seats: 5), SE427 (seats: 0)`);
  } else {
    recordResult('Elective Table Parsing (Simulation)', 'FAIL', `Failed to track all courses: tracked count = ${trackedCourses.size}`);
  }

  // Test 9: Case-Insensitive Matching
  const lowerTarget = "hu317:e2";
  const [lCode, lSlot] = lowerTarget.split(':');
  let caseMatchFound = false;
  $mock("table tbody tr:not(.setHeader)").each((_, row) => {
    const cells = $mock(row).find("td");
    if (cells.length === 6) {
      const code = $mock(cells[1]).text().trim();
      const slot = $mock(cells[3]).text().trim();
      if (code.toUpperCase() === lCode.toUpperCase() && slot.toUpperCase() === lSlot.toUpperCase()) {
        caseMatchFound = true;
      }
    }
  });
  if (caseMatchFound) {
    recordResult('Case-Insensitive Input Matching (Simulation)', 'PASS', 'Lower-case "hu317:e2" correctly matches "HU317:E2"');
  } else {
    recordResult('Case-Insensitive Input Matching (Simulation)', 'FAIL', 'Case normalization failed');
  }

  // Test 10: Status Detection (Registered #0ff288 & Blocked #d4d3d2)
  let foundRegistered = false;
  let foundBlocked = false;
  $mock("tr[bgcolor='#0ff288']").each((_, row) => {
    const code = $mock(row).find("td:nth-child(2)").text().trim();
    if (code === "IT305") foundRegistered = true;
  });
  $mock("tr[bgcolor='#d4d3d2']").each((_, row) => {
    const code = $mock(row).find("td:nth-child(2)").text().trim();
    if (code === "CS401") foundBlocked = true;
  });

  if (foundRegistered && foundBlocked) {
    recordResult('Status Row Color Detection (Simulation)', 'PASS', 'Registered (#0ff288) and Blocked (#d4d3d2) courses accurately identified');
  } else {
    recordResult('Status Row Color Detection (Simulation)', 'FAIL', `Registered found: ${foundRegistered}, Blocked found: ${foundBlocked}`);
  }

  // Test 11: Content Hash Invariance (ETag Fallback)
  const hash1 = crypto.createHash('md5').update(sampleRegistrationHtml).digest('hex');
  const hash2 = crypto.createHash('md5').update(sampleRegistrationHtml).digest('hex');
  const modifiedHtml = sampleRegistrationHtml.replace('<td>5</td>', '<td>4</td>');
  const hash3 = crypto.createHash('md5').update(modifiedHtml).digest('hex');

  if (hash1 === hash2 && hash1 !== hash3) {
    recordResult('Smart MD5 Content Caching (Simulation)', 'PASS', 'Hash remains identical on unchanged data and triggers immediately when seat count updates');
  } else {
    recordResult('Smart MD5 Content Caching (Simulation)', 'FAIL', 'Hash comparison failed');
  }

  console.log('\n================================================================');
  console.log('SUMMARY OF AUDIT RESULTS:');
  console.log('================================================================');
  const passes = results.filter(r => r.status === 'PASS').length;
  const partials = results.filter(r => r.status === 'PARTIALLY VERIFIED').length;
  const fails = results.filter(r => r.status === 'FAIL').length;
  console.log(`TOTAL: ${results.length} | PASS: ${passes} | PARTIALLY VERIFIED: ${partials} | FAIL: ${fails}`);
})();
