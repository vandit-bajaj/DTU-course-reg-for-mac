// Required Modules
const https = require('https');
const crypto = require('crypto');
const querystring = require('querystring');
const cheerio = require('cheerio');
const { performance } = require('perf_hooks');
const notifier = require('node-notifier');

// Custom HTTPS Agent Configuration
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Disable SSL certificate verification
  keepAlive: true,           // Enable keep-alive for persistent connections
  maxSockets: 50,            // Maximum number of sockets per host
  maxFreeSockets: 10,        // Maximum number of free sockets per host
});

// Function to Extract and Merge Cookies from Response Headers
function extractAndMergeCookies(headers, currentCookies) {
  const setCookies = headers['set-cookie'];
  if (setCookies) {
    const newCookies = setCookies.map(cookie => cookie.split(';')[0]);
    const cookieMap = new Map(
      (currentCookies || '')
        .split('; ')
        .filter(Boolean)
        .map(cookie => cookie.split('='))
    );
    newCookies.forEach(cookie => {
      const [key, value] = cookie.split('=');
      cookieMap.set(key, value);
    });
    return Array.from(cookieMap.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }
  return currentCookies || '';
}

// Function to Perform Login Automation
async function automateLogin({r,p}, targetHost = 'exam-setu.dtu.ac.in') {
  const got = (await import('got')).default;

  try {
    let cookies = "";

    // Step 1: GET `/` to retrieve initial cookies (e.g., `connect.sid`)
    let response = await got(`https://${targetHost}/`, {
      method: 'GET',
      headers: getCommonHeaders(targetHost),
      responseType: 'text',
      agent: { https: httpsAgent },
      followRedirect: false,
      throwHttpErrors: false,
      timeout: { request: 6000 },
    });

    // Merge cookies from the initial response
    cookies = extractAndMergeCookies(response.headers, cookies);
    console.log('Step 1: Retrieved initial cookies:', cookies);

    // Step 2: POST `/student/login` with credentials to retrieve `token`
    const credentials = querystring.stringify({
      roll_no: r,
      password: p,
    });

    response = await got(`https://${targetHost}/student/login`, {
      method: 'POST',
      body: credentials,
      headers: {
        "Host": targetHost,
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Origin": `https://${targetHost}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        "Referer": `https://${targetHost}/student/login`,
        "Accept-Encoding": "gzip, deflate, br",
        "Priority": "u=0, i",
        "Connection": "keep-alive",
        'Cookie': cookies,
        "DNT": "1",
      },
      responseType: 'text',
      agent: { https: httpsAgent },
      followRedirect: false,
      throwHttpErrors: false,
      timeout: { request: 6000 },
    });

    cookies = extractAndMergeCookies(response.headers, cookies);
    console.log('Step 2: Retrieved token and updated cookies:', cookies);

    const match = (response.headers['location'] || response.body).match(/\/student\/home\/([a-zA-Z0-9]+)/);
    let studentHash = "";
    if (match && match[1]) {
      studentHash = match[1];
      console.log('Extracted Student Hash:', studentHash);
    } else {
      // Check if redirected back to login (indicates invalid credentials)
      if (
        response.headers['location'] === '/student/login' ||
        response.body.includes('Redirecting to /student/login') ||
        response.body.includes('Invalid Roll No or Password') ||
        response.body.includes('Invalid password') ||
        response.body.includes('Student not found')
      ) {
        // Fetch the actual alert from /student/login if possible
        try {
          const loginCheck = await got(`https://${targetHost}/student/login`, {
            headers: {
              ...getCommonHeaders(targetHost),
              'Cookie': cookies,
            },
            agent: { https: httpsAgent },
            responseType: 'text',
            throwHttpErrors: false,
          });
          const $ = cheerio.load(loginCheck.body);
          const alertMsg = $('div.alert.alert-danger').text().replace(/\s+/g, ' ').replace('×', '').trim();
          if (alertMsg) {
            throw new Error(`Login failed: ${alertMsg}`);
          }
        } catch (fetchErr) {
          if (fetchErr.message.startsWith('Login failed:')) throw fetchErr;
        }
        throw new Error('Invalid Roll Number or Password.');
      }
      throw new Error('Could not extract student hash from the login response.');
    }

    return { cookies, studentHash };
  } catch (error) {
    console.error('Error during login:', error.message);
    throw error;
  }
}

async function automateLoginWithRetry(credentials, targetHost, callbacks) {
  let attempts = 0;
  const delayTime = 2000; // 2 seconds — avoids hammering the DTU server

  while (isRunning) {
    try {
      attempts++;
      callbacks.onStatusUpdate(`Login attempt ${attempts}...`);
      const result = await automateLogin(credentials, targetHost);
      callbacks.onStatusUpdate('Login successful.');
      return result;
    } catch (error) {
      if (!isRunning) {
        break;
      }
      if (error.message.includes('Invalid Roll Number or Password') || error.message.startsWith('Login failed:')) {
        throw error; // Do not retry on invalid credentials
      }
      callbacks.onStatusUpdate(`Login failed: ${error.message}. Retrying in ${delayTime}ms...`);
      await delay(delayTime);
    }
  }
  throw new Error("Automation stopped during login.");
}

// Function to Fetch Course Registration HTML Content
async function fetchCourseRegHTML(cookies, studentHash, targetHost = 'exam-setu.dtu.ac.in') {
  const { default: got } = await import('got');

  try {
    const response = await got(`https://${targetHost}/student/courseRegistration/${studentHash}`, {
      method: 'GET',
      headers: {
        ...getCommonHeaders(targetHost),
        'Referer': `https://${targetHost}/student/home/${studentHash}`,
        'Cookie': cookies,
      },
      agent: { https: httpsAgent },
      responseType: 'text',
      followRedirect: false,
      timeout: { request: 6000 },
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch course registration page. Status code: ${response.statusCode}`);
    }

    console.log('Fetched course registration page successfully.');
    // console.log(response.body);
    return response.body;
  } catch (error) {
    console.warn("Warning: Unable to fetch course registration HTML content.", error.message);
    return null;
  }
}

// Function to Fetch and Track Desired Courses
async function fetchTrackedCourses(cookies, studentHash, targetHost = 'exam-setu.dtu.ac.in', courseCodes) {
  const htmlContent = await fetchCourseRegHTML(cookies, studentHash, targetHost);

  if (!htmlContent) {
    throw new Error("No HTML content fetched for course registration.");
  }

  try {
    const $ = cheerio.load(htmlContent);
    const trackedCourses = new Map();

    // Normalize targets to uppercase trimmed strings
    const parsedCourses = new Map(
      courseCodes.map(code => {
        const [courseCode, courseSlot] = code.split(":");
        return [(courseCode || '').trim().toUpperCase(), (courseSlot || '').trim().toUpperCase()];
      })
    );

    // Resilient table selector: tries specific elective wrapper first, then general table
    let rows = $("div.elective-subjects table tbody tr:not(.setHeader)");
    if (rows.length === 0) {
      rows = $("table.table tbody tr:not(.setHeader)");
    }
    if (rows.length === 0) {
      rows = $("table tbody tr:not(.setHeader)");
    }

    rows.each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 5) {
        const courseCode = $(cells[1]).text().trim().toUpperCase();
        const courseSlot = $(cells[3]).text().trim().toUpperCase();
        const seats = parseInt($(cells[4]).text().trim(), 10) || 0;
        const formAction = $(cells[5]).find("form").attr("action") || $(row).find("form").attr("action");

        if (formAction) {
          const courseHashMatch = formAction.match(new RegExp(`/student/courseRegister/${studentHash}/([a-zA-Z0-9]+)`));
          const courseHash = courseHashMatch ? courseHashMatch[1] : null;

          if (courseHash && parsedCourses.has(courseCode) && parsedCourses.get(courseCode) === courseSlot) {
            trackedCourses.set(courseHash, {
              courseCode,
              courseSlot,
              seats,
            });
            parsedCourses.delete(courseCode); // Remove found course
            console.log(`Tracking Course: ${courseCode} (Slot: ${courseSlot}) with Hash: ${courseHash} and Seats: ${seats}`);
          }
        }
      }
    });

    // Check for courses that were not found
    if (parsedCourses.size > 0) {
      const notFound = Array.from(parsedCourses.keys()).join(', ');
      throw new Error(`The following course(s) were not found: ${notFound}. Please check the course code and slot.`);
    }
    return trackedCourses;
  } catch (error) {
    console.error("Error processing courses:", error.message);
    throw error;
  }
}

// Function to Fetch and Track Desired Courses with Retry on Server Lag or Early Launch
async function fetchTrackedCoursesWithRetry(cookies, studentHash, targetHost, courseCodes, callbacks) {
  let attempts = 0;
  const delayTime = 2000;

  while (isRunning) {
    attempts++;
    try {
      callbacks.onStatusUpdate(`Fetching course registration table (attempt ${attempts})...`);
      const trackedCourses = await fetchTrackedCourses(cookies, studentHash, targetHost, courseCodes);
      if (trackedCourses && trackedCourses.size > 0) {
        return trackedCourses;
      }
    } catch (error) {
      if (!isRunning) break;
      callbacks.onStatusUpdate(`Waiting for course table / retrying after server lag (${error.message}). Retrying in ${delayTime}ms...`);
      await delay(delayTime);
    }
  }
  throw new Error("Automation stopped while waiting for course registration table.");
}

// Function to Send POST Request for Course Registration
const sendPostReq = async (cookies, studentHash, targetHost = 'exam-setu.dtu.ac.in', courseHash) => {
  const { default: got } = await import('got');

  try {
    const response = await got.post(`https://${targetHost}/student/courseRegister/${studentHash}/${courseHash}`, {
      headers: {
        ...getCommonHeaders(targetHost),
        'Referer': `https://${targetHost}/student/courseRegistration/${studentHash}`,
        'Cookie': cookies,
        'Content-Length': '0',
      },
      responseType: "text",
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      followRedirect: false,
      timeout: { request: 5000 },
    });

    console.log(`POST Request to register course ${courseHash} - Status Code: ${response.statusCode}`);
    return { success: response.statusCode === 200 || response.statusCode === 302, statusCode: response.statusCode };
  } catch (error) {
    console.error("Error sending POST request:", error.message);
    return { success: false, error: error.message };
  }
};

let isRunning = false;

// Handler Logic to Monitor and Register Courses
const handlerLogic = async (session, targetHost = 'exam-setu.dtu.ac.in', trackedCourses, autoLogin, credentials, callbacks) => {
  const { default: got } = await import('got');
  let previousEtag = null;
  let currentSession = session;
  const registrationAttempts = new Map(); // Course registration attempt timestamp tracker

  const sendGetReq = async () => {
    if (!isRunning) return null;
    try {
      const response = await got(`https://${targetHost}/student/courseRegistration/${currentSession.studentHash}`, {
        method: 'GET',
        headers: {
          ...getCommonHeaders(targetHost),
          'Referer': `https://${targetHost}/student/home/${currentSession.studentHash}`,
          'Cookie': currentSession.cookies,
        },
        agent: { https: httpsAgent },
        responseType: 'text',
        followRedirect: false,
        timeout: { request: 5000 },
      });

      const $ = cheerio.load(response.body);

      // Targeted hashing of elective course table to avoid false positives from changing timestamps/banners
      const tableContent = $('div.elective-subjects, table').html() || response.body;
      const currentEtag = response.headers['etag'] || crypto.createHash('md5').update(tableContent).digest('hex');
      if (previousEtag && currentEtag === previousEtag) {
        callbacks.onStatusUpdate('No updates found (page unchanged).');
        return null;
      }
      callbacks.onStatusUpdate('Seat data checked (updates received).');
      previousEtag = currentEtag;

      const isRedirectToLogin = 
        (response.statusCode === 302 && response.headers['location']?.includes('/student/login')) ||
        (response.body.length < 18000 && (response.body.includes('Redirecting to /student/login') || $('p').text().includes('Found. Redirecting to /student/login')));

      if (isRedirectToLogin) {
        throw new Error("Session Expired");
      }

      const alertDiv = $('div.alert.alert-danger.alert-dismissible.fade.show[role="alert"]');
      if (alertDiv.length > 0) {
        callbacks.onStatusUpdate(`Alert: ${alertDiv.text().trim()}`);
      }

      $("tr[bgcolor='#0ff288']").each((_, element) => {
        const courseHashMatch = $(element).find("form[action*='/student/courseRegister/']").attr("action")?.match(/\/([a-f0-9]{24})$/);
        if (courseHashMatch) {
          const courseHash = courseHashMatch[1];
          if (trackedCourses.has(courseHash)) {
            const removedCourse = trackedCourses.get(courseHash);
            trackedCourses.delete(courseHash);
            callbacks.onCourseRegistered(removedCourse);
            callbacks.onStatusUpdate(`Course Already Registered: ${removedCourse.courseCode} - Dropping from tracking.`);
          }
        }
      });

      $("tr[bgcolor='#d4d3d2']").each((_, element) => {
        const courseHashMatch = $(element).find("form[action*='/student/courseRegister/']").attr("action")?.match(/\/([a-f0-9]{24})$/);
        if (courseHashMatch) {
          const courseHash = courseHashMatch[1];
          if (trackedCourses.has(courseHash)) {
            const blockedCourse = trackedCourses.get(courseHash);
            trackedCourses.delete(courseHash);
            callbacks.onCourseBlocked(blockedCourse);
            callbacks.onStatusUpdate(`Course is Blocked: ${blockedCourse.courseCode} - Dropping from tracking.`);
          }
        }
      });

      return $;
    } catch (error) {
      if (!isRunning) throw error;

      if (error.message.includes("Session Expired")) {
        if (autoLogin) {
          callbacks.onStatusUpdate("Session expired. Attempting to re-login...");
          try {
            currentSession = await automateLoginWithRetry(credentials, targetHost, callbacks);
            callbacks.onStatusUpdate("Session re-initiated successfully.");
            return null; // Retry the GET request with the new session
          } catch (loginError) {
            callbacks.onError(loginError.message);
            throw loginError;
          }
        } else {
          callbacks.onError("Session expired. Auto-login is disabled. Please restart and log in again.");
          throw error;
        }
      }

      // Handle HTTP errors (e.g., 404, 5xx) by retrying
      if (error.response && error.response.statusCode) {
        callbacks.onStatusUpdate(`Request failed with status ${error.response.statusCode}. Retrying...`);
        return null;
      }

      // Handle other errors (e.g., timeout, network drop)
      callbacks.onStatusUpdate(`Network warning: ${error.message}. Retrying...`);
      return null;
    }
  };

  const checkAndRegister = async () => {
    while (isRunning) {
      const $ = await sendGetReq();
      if (!$) {
        await delay(900);
        continue;
      }

      const slotsToTrack = groupCoursesBySlot(trackedCourses);
      let registeredSomething = false;

      for (const [courseSlot, courses] of slotsToTrack.entries()) {
        if (!isRunning) return;

        // Resilient slot header matching: checks for slot text case-insensitively regardless of colspan
        let slotHeader = $(`tr.setHeader td:contains(${courseSlot})`);
        if (slotHeader.length === 0) {
          $(`tr.setHeader`).each((_, hRow) => {
            if ($(hRow).text().toUpperCase().includes(courseSlot.toUpperCase())) {
              slotHeader = $(hRow).find("td").first();
            }
          });
        }
        if (slotHeader.length === 0) continue;

        const slotRows = gatherSlotRows(slotHeader);

        for (const row of slotRows) {
          if (!isRunning) return;
          const cells = $(row).find("td");
          const courseCode = $(cells[1]).text().trim().toUpperCase();
          const courseData = courses.find(c => c.courseCode.toUpperCase() === courseCode);

          if (courseData) {
            const { courseHash, seats: trackedSeats } = courseData;
            const newSeats = parseInt($(cells[4]).text().trim(), 10) || 0;

            if (newSeats !== trackedSeats) {
              const updatedCourseData = { ...courseData, seats: newSeats };
              trackedCourses.set(courseHash, updatedCourseData);
              callbacks.onStatusUpdate(`Seat Update: ${courseCode} (${courseData.courseSlot}) - Seats: ${trackedSeats} -> ${newSeats}`);
            }

            if (newSeats > 0) {
              // Duplicate protection: prevent repeated POST spam within 3 seconds for same course hash
              const lastAttempt = registrationAttempts.get(courseHash) || 0;
              if (Date.now() - lastAttempt > 3000) {
                registrationAttempts.set(courseHash, Date.now());
                callbacks.onStatusUpdate(`Attempting to register for ${courseCode} (${courseData.courseSlot})...`);
                const postRes = await sendPostReq(currentSession.cookies, currentSession.studentHash, targetHost, courseHash);
                if (postRes && postRes.success) {
                  registeredSomething = true;
                  break;
                } else {
                  // If request failed (e.g. server 504 / timeout / network drop), clear cooldown so it retries next poll
                  registrationAttempts.delete(courseHash);
                }
              }
            }
          }
        }
        if (registeredSomething) break;
      }

      if (registeredSomething) {
        await delay(1000);
        continue;
      }

      if (trackedCourses.size === 0) {
        callbacks.onStatusUpdate('All courses have been registered. Stopping automation.');
        break;
      }

      await delay(900);
    }
  };

  await checkAndRegister();
};

// Utility Function to Get Common Headers
function getCommonHeaders(host = 'exam-setu.dtu.ac.in') {
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

// Utility Function to Delay Execution
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility Function to Group Courses by Slot
function groupCoursesBySlot(trackedCourses) {
  const slotsToTrack = new Map();
  for (const [courseHash, { courseCode, courseSlot, seats }] of trackedCourses.entries()) {
    if (!slotsToTrack.has(courseSlot)) {
      slotsToTrack.set(courseSlot, []);
    }
    slotsToTrack.get(courseSlot).push({ courseHash, courseCode, seats });
  }
  return slotsToTrack;
}

// Utility Function to Gather Rows Under a Slot Header
function gatherSlotRows(slotHeader) {
  const slotRows = [];
  let currentRow = slotHeader.parent().next();
  while (currentRow.length > 0) {
    if (currentRow.hasClass("setHeader")) break;
    slotRows.push(currentRow[0]);
    currentRow = currentRow.next();
  }
  return slotRows;
}

// Main Execution Function
async function startAutomation(credentials, targetHost = 'exam-setu.dtu.ac.in', courseIdsToTrack, autoLogin, callbacks) {
  isRunning = true;
  try {
    let session;
    if (autoLogin) {
      session = await automateLoginWithRetry(credentials, targetHost, callbacks);
    } else {
      callbacks.onStatusUpdate('Attempting to log in...');
      session = await automateLogin(credentials, targetHost);
    }

    callbacks.onStatusUpdate('Login successful. Fetching courses...');
    const trackedCourses = await fetchTrackedCoursesWithRetry(session.cookies, session.studentHash, targetHost, courseIdsToTrack, callbacks);

    if (trackedCourses.size === 0) {
      throw new Error("No courses to track. They may already be registered or the list is empty.");
    }
    
    if (!isRunning) return;

    callbacks.onStatusUpdate(`Now tracking ${trackedCourses.size} course(s). Monitoring for seat availability...`);

    // Override onCourseRegistered to also fire a Mac desktop notification
    const originalOnCourseRegistered = callbacks.onCourseRegistered;
    callbacks.onCourseRegistered = (course) => {
      notifier.notify({
        title: 'Course Registered! 🎉',
        message: `${course.courseCode} (Slot: ${course.courseSlot}) successfully registered.`,
        icon: require('path').join(__dirname, 'assets', 'dtulogo.png'),
        sound: true,
        wait: false,
      });
      originalOnCourseRegistered(course);
    };

    await handlerLogic(session, targetHost, trackedCourses, autoLogin, credentials, callbacks);
  } catch (error) {
    callbacks.onError(error.message);
  } finally {
    isRunning = false;
    if (callbacks && callbacks.onStop) {
      callbacks.onStop();
    }
  }
}

function stopAutomation() {
  if (isRunning) {
    isRunning = false;
  }
}

module.exports = { startAutomation, stopAutomation };
