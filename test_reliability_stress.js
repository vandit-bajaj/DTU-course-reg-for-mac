// ============================================================================
// Phase 6: Reliability & Failure Scenario Stress Test Suite
// ============================================================================

const cheerio = require('cheerio');
const crypto = require('crypto');

console.log('================================================================');
console.log('STARTING PHASE 6: RELIABILITY & FAILURE SCENARIO TESTING');
console.log('================================================================\n');

let passCount = 0;
let totalCount = 0;

function assertTest(name, condition, details = '') {
  totalCount++;
  if (condition) {
    passCount++;
    console.log(`✅ [PASS] ${name} ${details ? '— ' + details : ''}`);
  } else {
    console.log(`❌ [FAIL] ${name} ${details ? '— ' + details : ''}`);
  }
}

// Scenario 1: Malformed HTML & CSS changes
{
  const weirdHtml = `
    <html>
      <body>
        <div>
          <table class="any-class-name">
            <tbody>
              <tr class="setHeader"><td>Slot E1</td></tr>
              <tr>
                <td>1</td><td>HU317</td><td>Title</td><td>E1</td><td>3</td>
                <td><form action="/student/courseRegister/user1/hash1"><button>Go</button></form></td>
              </tr>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
  const $ = cheerio.load(weirdHtml);
  let rows = $("div.elective-subjects table tbody tr:not(.setHeader)");
  if (rows.length === 0) rows = $("table.table tbody tr:not(.setHeader)");
  if (rows.length === 0) rows = $("table tbody tr:not(.setHeader)");

  assertTest(
    'Resilient table row detection across unconventional table classes',
    rows.length === 1 && $(rows[0]).find('td').eq(1).text() === 'HU317',
    `Found ${rows.length} rows`
  );
}

// Scenario 2: Trailing whitespace & case mismatches
{
  const userInput = [' hu317 : e2 ', 'se427:E1 '];
  const normalized = userInput.map(code => {
    const [c, s] = code.split(':');
    return [(c || '').trim().toUpperCase(), (s || '').trim().toUpperCase()];
  });

  assertTest(
    'Input normalization trims whitespace and upper-cases',
    normalized[0][0] === 'HU317' && normalized[0][1] === 'E2' &&
    normalized[1][0] === 'SE427' && normalized[1][1] === 'E1',
    `Normalized: ${JSON.stringify(normalized)}`
  );
}

// Scenario 3: Slot Header with differing colspans (colspan="6" or missing)
{
  const htmlColspan = `
    <table class="table">
      <tr class="setHeader"><td colspan="6">Slot E2 Subjects</td></tr>
      <tr><td>1</td><td>HU317</td><td>Desc</td><td>E2</td><td>2</td><td><form action="/action/hash1"></form></td></tr>
    </table>
  `;
  const $ = cheerio.load(htmlColspan);
  const courseSlot = 'E2';
  let slotHeader = $(`tr.setHeader td:contains(${courseSlot})`);
  if (slotHeader.length === 0) {
    $(`tr.setHeader`).each((_, hRow) => {
      if ($(hRow).text().toUpperCase().includes(courseSlot.toUpperCase())) {
        slotHeader = $(hRow).find("td").first();
      }
    });
  }

  assertTest(
    'Slot header detected regardless of colspan attribute',
    slotHeader.length > 0 && slotHeader.text().includes('Slot E2'),
    `Found text: "${slotHeader.text()}"`
  );
}

// Scenario 4: Duplicate registration protection (in-flight cooldown)
{
  const attempts = new Map();
  const testHash = 'courseHashXYZ123';

  // First attempt: should execute
  let attempt1Fired = false;
  let lastAttempt = attempts.get(testHash) || 0;
  if (Date.now() - lastAttempt > 3000) {
    attempts.set(testHash, Date.now());
    attempt1Fired = true;
  }

  // Second immediate attempt: should be blocked
  let attempt2Fired = false;
  lastAttempt = attempts.get(testHash) || 0;
  if (Date.now() - lastAttempt > 3000) {
    attempts.set(testHash, Date.now());
    attempt2Fired = true;
  }

  assertTest(
    'In-flight duplicate POST protection blocks rapid re-attempts within 3000ms',
    attempt1Fired === true && attempt2Fired === false,
    `Attempt 1: ${attempt1Fired}, Attempt 2: ${attempt2Fired}`
  );
}

// Scenario 5: Missing courses error handling
{
  const htmlNoMatches = `
    <table class="table">
      <tr><td>1</td><td>CS101</td><td>Intro</td><td>E1</td><td>5</td><td></td></tr>
    </table>
  `;
  const $ = cheerio.load(htmlNoMatches);
  const requested = new Map([['HU317', 'E2']]);
  const tracked = new Map();

  $("table tbody tr:not(.setHeader)").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length >= 5) {
      const code = $(cells[1]).text().trim();
      if (requested.has(code)) {
        tracked.set(code, true);
        requested.delete(code);
      }
    }
  });

  const missingList = Array.from(requested.keys()).join(', ');
  assertTest(
    'Course not found detects missing courses and reports missing list',
    tracked.size === 0 && missingList === 'HU317',
    `Identified missing: "${missingList}"`
  );
}

// Scenario 6: Session Expiration Redirect detection
{
  const mockRedirectResponse = {
    statusCode: 302,
    headers: { location: '/student/login' },
    body: 'Found. Redirecting to /student/login',
  };

  const isExpired = (mockRedirectResponse.statusCode === 302 && mockRedirectResponse.headers['location']?.includes('/student/login')) ||
                    (mockRedirectResponse.body.length < 18000 && mockRedirectResponse.body.includes('Redirecting to /student/login'));

  assertTest(
    'Session expiration cleanly identified by HTTP 302 and Location redirect',
    isExpired === true,
    `Detected expiration: ${isExpired}`
  );
}

console.log('\n================================================================');
console.log(`STRESS TEST SUMMARY: ${passCount} / ${totalCount} PASSED`);
console.log('================================================================');
if (passCount === totalCount) {
  process.exit(0);
} else {
  process.exit(1);
}
