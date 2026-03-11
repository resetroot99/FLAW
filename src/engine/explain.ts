/**
 * Beginner-friendly explanations for every FLAW rule.
 * Written in plain English for vibe coders who may not know the jargon.
 */

export interface RuleExplain {
  /** One-sentence "what went wrong" in plain English */
  what: string;
  /** Why this matters — real consequences, not abstract risk */
  why: string;
  /** Step-by-step fix a beginner can follow */
  steps: string[];
  /** A ready-to-paste prompt for your AI coding assistant */
  prompt: string;
}

const explanations: Record<string, RuleExplain> = {
  // ── Security & Auth ────────────────────────────────
  'FK-SA-SECRET-001': {
    what: 'A password, API key, or secret token is written directly in your code instead of being stored safely.',
    why: 'Anyone who sees your code (GitHub, a teammate, a hacker) can steal these credentials and access your accounts, databases, or paid services.',
    steps: [
      'Copy the secret value somewhere safe (a password manager or note)',
      'Delete the secret from your code file',
      'Create a .env file in your project root and put the secret there: MY_SECRET=the_value',
      'In your code, read it from the environment: process.env.MY_SECRET (JS) or os.environ["MY_SECRET"] (Python)',
      'Make sure .env is in your .gitignore so it never gets committed',
      'If this secret was ever pushed to GitHub, rotate it immediately — treat it as compromised',
    ],
    prompt: 'This file has a hardcoded secret (API key, password, or token). Move it to a .env file and load it from environment variables instead. Make sure .env is in .gitignore. Show me exactly what to change.',
  },

  'FK-SA-AUTH-001': {
    what: 'This API endpoint doesn\'t check who\'s calling it — anyone on the internet could use it.',
    why: 'Without authentication, strangers can read your data, make changes, or abuse your server. It\'s like leaving your front door wide open.',
    steps: [
      'Decide if this endpoint really needs to be public (login pages, health checks are OK)',
      'If it needs auth: add a middleware or decorator that checks for a valid token/session',
      'For FastAPI: add current_user: User = Depends(get_current_user) to the function parameters',
      'For Express: add your auth middleware before the route handler',
      'Test by calling the endpoint without a token — it should return 401 Unauthorized',
    ],
    prompt: 'This API route has no authentication check. Add authentication so only logged-in users can access it. Use the existing auth pattern from other routes in this project. Show me the exact code changes.',
  },

  'FK-SA-AUTHZ-001': {
    what: 'This code fetches a record by its ID but doesn\'t check if the current user is allowed to see it.',
    why: 'A user could change the ID in the URL and access someone else\'s data. This is called an IDOR vulnerability and it\'s one of the most common security bugs.',
    steps: [
      'After fetching the record by ID, check that it belongs to the current user',
      'Add a WHERE clause: ...WHERE id = ? AND user_id = current_user.id',
      'Or after fetching, compare: if (record.userId !== currentUser.id) return 403',
      'Test by logging in as User A and trying to access User B\'s resource by ID',
    ],
    prompt: 'This code looks up a resource by ID without checking ownership. Add an ownership check so users can only access their own data. Use the current user/tenant context from the auth middleware.',
  },

  'FK-SA-INPUT-001': {
    what: 'Your code puts user-supplied text directly into HTML without escaping it.',
    why: 'An attacker could type <script>steal_cookies()</script> into a form field and it would run in other users\' browsers. This is called XSS (Cross-Site Scripting).',
    steps: [
      'Never use dangerouslySetInnerHTML, v-html, or innerHTML with user data',
      'Use your framework\'s normal rendering (React JSX, Vue templates) — they escape automatically',
      'If you must render HTML, sanitize it first with a library like DOMPurify',
    ],
    prompt: 'This code uses dangerouslySetInnerHTML/innerHTML/v-html which is an XSS risk. Replace it with safe rendering or add DOMPurify sanitization. Show me the fix.',
  },

  // ── Error Handling ─────────────────────────────────
  'FK-EH-SILENT-001': {
    what: 'Your code catches an error but does nothing with it — it just silently continues as if nothing happened.',
    why: 'When errors are swallowed, your app breaks in confusing ways. Users see blank screens, data gets lost, and you have zero clues to debug it because nothing was logged.',
    steps: [
      'At minimum, log the error: console.error(error) or logger.error(str(e))',
      'Decide: should the app retry, show an error message, or stop?',
      'Never use "except: pass" or "catch(e) {}" — always handle or log',
      'For user-facing code, show a friendly error message instead of a blank screen',
    ],
    prompt: 'This code has empty catch/except blocks that silently swallow errors. Add proper error handling: log the error, show user-friendly messages where appropriate, and re-throw if the caller needs to know. Show me the changes.',
  },

  'FK-EH-SILENT-002': {
    what: 'Your code catches an error but does nothing with it — the error just disappears.',
    why: 'Same as above — silent failures make your app unpredictable and nearly impossible to debug.',
    steps: [
      'Add logging inside the catch/except block',
      'Consider whether the error should be re-thrown',
      'For critical operations (saving data, payments), always surface errors to the user',
    ],
    prompt: 'This catch/except block silently ignores errors. Add error logging and appropriate error handling. Show me the fix.',
  },

  'FK-EH-FALLBACK-001': {
    what: 'When this API call or async operation fails, there\'s no plan B — the app just breaks.',
    why: 'Network requests fail all the time (slow internet, server down, timeout). Without a fallback, your users see a broken page or lost data.',
    steps: [
      'Wrap the async call in try/catch',
      'On failure: show an error message, offer a retry button, or use cached data',
      'Add loading and error states to your UI component',
      'Consider a timeout — don\'t let users wait forever',
    ],
    prompt: 'This async operation has no error handling or fallback. Add try/catch with user-friendly error states and a retry option where appropriate. Show me the implementation.',
  },

  'FK-EH-FALSESUCCESS-001': {
    what: 'Your code shows a "Success!" message before it actually knows if the operation worked.',
    why: 'The user thinks their data was saved, but it might have failed. They walk away thinking everything is fine, but nothing was actually saved.',
    steps: [
      'Move the success message AFTER the await completes',
      'Add a try/catch: show success in the try, show error in the catch',
      'Pattern: try { await save(); showSuccess(); } catch { showError(); }',
    ],
    prompt: 'This code shows a success notification before the async operation completes. Move the success feedback to after the await resolves, and add error handling for failures. Show the fix.',
  },

  // ── Feature Reality ────────────────────────────────
  'FK-FR-MOCK-001': {
    what: 'This file has fake/mock data (like hardcoded users, dummy emails, or test values) in production code.',
    why: 'If mock data leaks to production, users see fake content, tests give false results, and the app looks broken or unfinished.',
    steps: [
      'Search for hardcoded arrays of fake data, Lorem ipsum, or test@example.com',
      'Replace with real API calls or database queries',
      'Move test data to separate test files or fixtures',
      'If you need placeholder data, load it only in development mode',
    ],
    prompt: 'This file contains mock/fake/placeholder data that should not be in production code. Replace it with real data fetching from the API or database. Move any test data to test fixtures. Show me the changes.',
  },

  'FK-FR-STATE-001': {
    what: 'The UI shows success before the server confirms the operation actually worked.',
    why: 'Users think their action worked, but it may have silently failed. This erodes trust in your app.',
    steps: [
      'Show a loading state while the request is in progress',
      'Only show success after the server responds with a 2xx status',
      'Show an error if the request fails',
    ],
    prompt: 'This code updates the UI optimistically before the server confirms success. Add proper loading states and only show success after the API call resolves. Show the fix.',
  },

  'FK-FR-CLAIM-001': {
    what: 'There\'s a TODO, FIXME, or HACK comment in important code — meaning the developer left it unfinished.',
    why: 'These are markers that a feature isn\'t done yet. If it\'s in auth, payments, or data handling, the missing piece could cause real problems.',
    steps: [
      'Read the TODO comment to understand what\'s missing',
      'Either implement the missing logic or remove the dead code',
      'If you can\'t fix it now, create a GitHub issue to track it',
      'Never ship TODOs in critical paths (auth, payments, data saving)',
    ],
    prompt: 'This critical code path has TODO/FIXME/HACK comments indicating unfinished work. Implement the missing logic described in the comments. Show me what needs to change.',
  },

  'FK-FR-STUB-001': {
    what: 'This function exists but does nothing — its body is just "pass" or "return None". It\'s a placeholder, not real code.',
    why: 'Code that calls this function expects it to do something. Since it does nothing, features that depend on it are silently broken.',
    steps: [
      'Read what the function is supposed to do (check its name and where it\'s called)',
      'Implement the actual logic',
      'If the function is truly unnecessary, delete it and remove all calls to it',
      'Test by calling the feature that depends on this function',
    ],
    prompt: 'This function is a stub — it has no real implementation (just "pass" or returns empty). Implement the actual logic based on the function name and how it\'s used in the codebase. Show me the implementation.',
  },

  // ── Frontend Wiring ────────────────────────────────
  'FK-FW-BTN-001': {
    what: 'There\'s a button in the UI that doesn\'t do anything when clicked — no onClick handler attached.',
    why: 'Users click the button, nothing happens, and they think the app is broken. This is a dead UI element.',
    steps: [
      'Find the button in your component',
      'Add an onClick handler: <button onClick={handleMyAction}>',
      'Implement the handler function with the intended behavior',
      'Test by clicking the button and verifying the expected action occurs',
    ],
    prompt: 'This button has no click handler. Add an onClick handler that performs the intended action. Look at similar buttons in the project for the pattern to follow. Show me the fix.',
  },

  'FK-FW-FORM-001': {
    what: 'There\'s a form that doesn\'t have an onSubmit handler — pressing Submit does nothing (or reloads the page).',
    why: 'Users fill out the form, hit submit, and their data goes nowhere. The page might just reload and their input is lost.',
    steps: [
      'Add onSubmit to the form: <form onSubmit={handleSubmit}>',
      'In the handler, call e.preventDefault() first to stop page reload',
      'Collect the form data and send it to your API',
      'Show loading, success, and error states',
    ],
    prompt: 'This form has no onSubmit handler. Add form submission handling that collects the data, sends it to the API, and shows appropriate feedback. Show me the implementation.',
  },

  'FK-FW-STATE-001': {
    what: 'There are console.log statements left in event handlers — debug code that shouldn\'t be in production.',
    why: 'Console logs in production slow down the app, leak internal data in the browser console, and look unprofessional.',
    steps: [
      'Remove console.log from onClick, onChange, and onSubmit handlers',
      'If you need logging, use a proper logger that can be disabled in production',
      'Keep console.error for actual errors if needed',
    ],
    prompt: 'Remove the console.log statements from these event handlers. Replace with proper state updates or remove if they were just for debugging. Show the changes.',
  },

  'FK-FW-STATE-002': {
    what: 'State is being set but nothing in the UI reacts to it — the state change is pointless.',
    why: 'You\'re updating state (useState, setState) but no component reads it. It\'s dead code that adds confusion.',
    steps: [
      'Find where the state is set and check if any JSX uses it',
      'If nothing uses it, remove the state variable entirely',
      'If it should be used, wire it into the UI (show/hide, display value, etc.)',
    ],
    prompt: 'This state variable is being updated but never used in the UI. Either wire it into the JSX to display it, or remove the unused state. Show the fix.',
  },

  'FK-FW-NAV-001': {
    what: 'A link or navigation action points to a route that doesn\'t exist in your app.',
    why: 'Users click the link and get a 404 page or blank screen. Dead links make your app feel broken.',
    steps: [
      'Check what route the link points to',
      'Either create the missing page/route, or fix the link to point to the correct path',
      'Test by clicking the link and verifying it loads the right page',
    ],
    prompt: 'This link/navigation points to a route that doesn\'t exist. Either create the missing route or fix the href/to path to point to the correct page. Show the fix.',
  },

  'FK-FW-WIRE-001': {
    what: 'The frontend is calling an API endpoint that doesn\'t exist on the backend.',
    why: 'The feature will fail with a network error when users try to use it. It looks like it works in the UI but the data never actually saves/loads.',
    steps: [
      'Check what URL the frontend is calling',
      'Either create the missing backend endpoint, or fix the frontend URL to match an existing one',
      'Test the full flow: click the button → watch the network tab → verify the response',
    ],
    prompt: 'The frontend calls an API endpoint that doesn\'t exist on the backend. Either create the missing endpoint or fix the URL to match an existing route. Show both the frontend and backend changes needed.',
  },

  'FK-FW-WIRE-002': {
    what: 'The frontend sends or expects data in a different shape than the backend provides.',
    why: 'The API call might succeed but the UI shows undefined/blank because it\'s looking for field names that don\'t match.',
    steps: [
      'Compare what the frontend expects (check the fetch/axios call) with what the backend returns',
      'Pick one as the source of truth and update the other to match',
      'Use TypeScript types or Pydantic models to keep them in sync',
    ],
    prompt: 'The frontend and backend use different data shapes/field names. Align them so the API response matches what the frontend expects. Show the changes on both sides.',
  },

  'FK-FW-WIRE-003': {
    what: 'The frontend reads a field from the API response that the backend doesn\'t actually send.',
    why: 'The UI will show "undefined" or blank where the data should be.',
    steps: [
      'Check what fields the frontend is reading from the response',
      'Compare with the actual backend response (check with a REST client or network tab)',
      'Add the missing field to the backend, or fix the frontend to use the correct field name',
    ],
    prompt: 'The frontend reads fields from the API response that don\'t exist in the backend response. Fix the mismatch by aligning field names. Show the changes.',
  },

  'FK-FW-ASYNC-001': {
    what: 'An async function (API call, database query) is called without "await" — the result is ignored.',
    why: 'The code continues before the operation finishes. Data might not be saved, errors are silently lost, and the UI shows stale information.',
    steps: [
      'Add "await" before the async function call',
      'Make sure the parent function is also marked as "async"',
      'Add try/catch around the await for error handling',
    ],
    prompt: 'This async function call is missing "await". Add await and proper error handling so the operation completes before the code continues. Show the fix.',
  },

  'FK-FW-EFFECT-001': {
    what: 'A useEffect hook has a missing or wrong dependency array — it might run too often or not when it should.',
    why: 'Missing deps means stale data in your UI. Extra deps means infinite re-render loops that freeze the browser.',
    steps: [
      'Check what variables the useEffect uses from outside its scope',
      'Add those variables to the dependency array: useEffect(() => { ... }, [dep1, dep2])',
      'If you truly want it to run once, use [] and make sure it doesn\'t need any reactive values',
      'Use the React ESLint plugin — it tells you exactly what deps are missing',
    ],
    prompt: 'This useEffect has incorrect dependencies. Fix the dependency array to include all values used inside the effect. Show the corrected code.',
  },

  'FK-FW-EFFECT-002': {
    what: 'A useEffect registers an event listener or subscription but never cleans it up.',
    why: 'Every time the component re-renders, a new listener is added without removing the old one. This causes memory leaks, duplicate events, and weird bugs.',
    steps: [
      'Return a cleanup function from useEffect that removes the listener',
      'Pattern: useEffect(() => { window.addEventListener("x", fn); return () => window.removeEventListener("x", fn); }, [])',
      'For subscriptions: return () => subscription.unsubscribe()',
    ],
    prompt: 'This useEffect adds an event listener or subscription without a cleanup function. Add a return function that removes the listener. Show the fix.',
  },

  // ── Backend Integrity ──────────────────────────────
  'FK-BE-PERSIST-001': {
    what: 'Data is being written to a variable or local state but never actually saved to a database or file.',
    why: 'Users think their changes are saved, but the data disappears when the server restarts or the session ends.',
    steps: [
      'Find where the data is being stored — is it just in memory (a variable/array)?',
      'Replace with a real database write (INSERT/UPDATE) or file save',
      'Verify the data persists by restarting the server and checking',
    ],
    prompt: 'This code writes data to memory/state but never persists it to a database. Add proper database persistence so data survives server restarts. Show the changes.',
  },

  'FK-BE-UNUSED-001': {
    what: 'There\'s a backend function or module that nothing calls — it\'s dead code.',
    why: 'Dead code adds confusion, makes the codebase harder to understand, and might have security issues that never get noticed.',
    steps: [
      'Search your project for any references to this function/module',
      'If nothing uses it, delete it',
      'If it should be used, wire it into the appropriate route or service',
    ],
    prompt: 'This backend function/module appears to be unused (nothing calls it). If it\'s needed, wire it in. If not, remove the dead code. Show me what to do.',
  },

  'FK-BE-CONTRACT-001': {
    what: 'Different API endpoints return data in different formats — some return { data: ... }, others return the object directly.',
    why: 'The frontend has to handle multiple response formats, leading to bugs where it reads the wrong property and shows undefined.',
    steps: [
      'Pick one response format and use it everywhere (recommended: { data: ..., error: null })',
      'Update all endpoints to use the same wrapper',
      'Update frontend API calls to expect the consistent format',
    ],
    prompt: 'The API endpoints use inconsistent response formats. Standardize them all to use the same response wrapper. Show the changes needed.',
  },

  'FK-BE-ENDPOINT-001': {
    what: 'The frontend calls an API URL that doesn\'t match any backend route.',
    why: 'The feature is broken — it will fail with a 404 error every time a user tries to use it.',
    steps: [
      'Check the exact URL the frontend is calling (look at fetch/axios calls)',
      'Check what routes the backend exposes (look at router definitions)',
      'Fix whichever side is wrong — either update the URL or create the missing route',
    ],
    prompt: 'The frontend calls an API endpoint that doesn\'t exist on the backend. Fix the URL mismatch or create the missing route. Show both sides.',
  },

  'FK-BE-ORPHAN-001': {
    what: 'There\'s a backend API route that nothing in the frontend calls — it\'s unused.',
    why: 'Orphaned routes waste server resources, might have security holes, and confuse future developers.',
    steps: [
      'Check if any frontend code calls this endpoint',
      'If it\'s planned for future use, add a comment explaining when it will be used',
      'If it\'s truly dead, remove the route',
    ],
    prompt: 'This backend route has no corresponding frontend call. Determine if it\'s needed and either wire it up or remove it. Show me what to do.',
  },

  'FK-BE-WIRE-001': {
    what: 'The backend registers a route but the actual handler function is missing or empty.',
    why: 'Calling this endpoint returns an error or an empty response. The feature exists in name only.',
    steps: [
      'Find the route registration and its handler function',
      'Implement the handler with real logic',
      'Test by calling the endpoint with a REST client (Postman, curl)',
    ],
    prompt: 'This backend route is registered but the handler is empty or missing. Implement the handler logic. Show the implementation.',
  },

  'FK-BE-SHAPE-001': {
    what: 'The backend returns data with different field names than what the frontend expects.',
    why: 'The UI shows "undefined" or wrong values because it\'s looking for "userName" but the API sends "user_name".',
    steps: [
      'Compare the frontend property access with the actual API response',
      'Either rename the backend fields or update the frontend to use the right names',
      'Consider using a serializer/transformer to keep naming consistent',
    ],
    prompt: 'The API response shape doesn\'t match what the frontend expects. Align the field names between frontend and backend. Show the changes.',
  },

  'FK-BE-DEAD-001': {
    what: 'There are router registrations that are commented out — these features are disabled.',
    why: 'Features that users might expect to work are silently disabled. If you uncomment them later, they might be broken because they haven\'t been maintained.',
    steps: [
      'Decide: is this feature needed or not?',
      'If needed: uncomment the registration, test the route, and fix any issues',
      'If not needed: delete the commented-out code entirely (version control has the history)',
    ],
    prompt: 'These router registrations are commented out, disabling features. Either uncomment and fix them, or delete the dead code. Show what to do.',
  },

  // ── Validation ─────────────────────────────────────
  'FK-VB-SERVER-001': {
    what: 'User input is only checked on the frontend — the backend accepts anything.',
    why: 'Anyone can bypass your frontend (using curl, Postman, or browser dev tools) and send bad data directly to your API. Frontend validation is for UX, server validation is for security.',
    steps: [
      'Add validation on the backend for every field: check type, length, format',
      'For FastAPI: use Pydantic models with Field() constraints',
      'For Express: use a library like zod, joi, or express-validator',
      'Test by sending bad data directly to the API (skip the frontend)',
    ],
    prompt: 'This API endpoint accepts user input without server-side validation. Add backend validation using the project\'s validation library (Pydantic/zod/joi). Show the implementation.',
  },

  'FK-VB-UNBOUNDED-001': {
    what: 'This input model accepts strings, lists, or dicts with no size limit — a user could send megabytes of data.',
    why: 'An attacker can send enormous payloads to crash your server or eat all your memory. This is a Denial of Service (DoS) vulnerability.',
    steps: [
      'Add Field() constraints to Pydantic models: Field(max_length=500) for strings',
      'For lists: Field(max_length=100) to limit array size',
      'For dicts: validate keys and limit entries',
      'Set a max request body size in your web server config as a safety net',
    ],
    prompt: 'This Pydantic model has unbounded input fields (no max_length on strings, no size limits on lists). Add Field() constraints to prevent DoS attacks. Show the changes.',
  },

  'FK-VB-RAWDICT-001': {
    what: 'This API endpoint accepts a raw dict/dictionary instead of a typed model — anything goes.',
    why: 'Without a schema, the server accepts any key-value pairs. This means no validation, no documentation, and attackers can inject unexpected fields.',
    steps: [
      'Create a Pydantic model that defines exactly what fields are expected',
      'Replace "data: dict" with "data: MyModel" in the route parameters',
      'Add field types and constraints to the model',
    ],
    prompt: 'This route accepts raw dict instead of a typed Pydantic model. Create a proper model with typed fields and replace the dict parameter. Show the changes.',
  },

  // ── Data Model ─────────────────────────────────────
  'FK-DM-TENANT-001': {
    what: 'This database query fetches ALL records without filtering by user or organization.',
    why: 'User A might see User B\'s private data. This is a data leak vulnerability and a common compliance violation (GDPR, HIPAA, etc.).',
    steps: [
      'Add a WHERE clause to filter by the current user\'s ID or tenant ID',
      'Get the user/tenant from the auth context (request.user, current_user, etc.)',
      'Pattern: SELECT * FROM items WHERE tenant_id = current_user.tenant_id',
      'Test by creating data as two different users and verify they can\'t see each other\'s records',
    ],
    prompt: 'This database query fetches all records without tenant/user scoping. Add a WHERE filter using the current user\'s tenant_id or user_id from the auth context. Show the fix.',
  },

  'FK-DM-SCHEMA-001': {
    what: 'This database model doesn\'t have createdAt/updatedAt timestamp fields.',
    why: 'Without timestamps, you can\'t tell when records were created or last modified. Debugging, auditing, and sorting by "newest" all become impossible.',
    steps: [
      'Add createdAt and updatedAt fields to the model',
      'Set createdAt to auto-fill with the current time on creation',
      'Set updatedAt to auto-update whenever the record changes',
      'Run a migration to add the columns to existing tables',
    ],
    prompt: 'This database model lacks timestamp fields. Add createdAt and updatedAt with auto-fill behavior. Show the model changes and migration.',
  },

  'FK-DM-NULLABLE-001': {
    what: 'A database column that looks important (like "name", "email", "status") allows NULL values with no default.',
    why: 'Required fields with no value cause crashes, display bugs ("Hello, null!"), and broken queries downstream.',
    steps: [
      'Decide: is NULL a valid state for this field?',
      'If no: make it non-nullable (nullable=False) and set a sensible default',
      'If yes: handle NULL in all code that reads this field',
      'Run a migration to fix existing NULL values in the database',
    ],
    prompt: 'This important database column is nullable without a default value. Make it non-nullable with a sensible default, or add explicit NULL handling. Show the fix.',
  },

  'FK-DM-DEMO-001': {
    what: 'Test or demo data is being imported into production code.',
    why: 'Fake data in production means users see dummy content, or worse, test records pollute real data. "John Doe" showing up in a live app looks broken.',
    steps: [
      'Move the import of seed/demo data to test files only',
      'If you need default data in production, create a proper seeding script that runs separately',
      'Add an environment check: only load demo data in development/test mode',
    ],
    prompt: 'Seed/demo data is imported in production code. Move it to test files or behind an environment check. Show the changes.',
  },

  'FK-DM-EXPOSE-001': {
    what: 'There are database model fields that are never exposed through any API endpoint.',
    why: 'If you\'re storing data that\'s never returned to users, it might be dead code — or it\'s a feature that was never finished.',
    steps: [
      'Check if the field is intentionally internal (e.g., hashed_password — should NOT be exposed)',
      'If it\'s user-facing data, add it to the API response',
      'If it\'s truly unused, consider removing the column',
    ],
    prompt: 'These database fields are never exposed through the API. Determine if they should be included in responses or if they\'re unused. Show what to do.',
  },

  // ── Maintainability ────────────────────────────────
  'FK-MH-SIZE-001': {
    what: 'This file is massive — it has way too much code in a single file.',
    why: 'Giant files are hard to read, hard to debug, and cause painful merge conflicts when multiple people edit them. AI tools also struggle with very large files.',
    steps: [
      'Identify groups of related functions within the file',
      'Move each group into its own file (e.g., utils.ts → validation.ts, formatting.ts)',
      'Update imports throughout your project to point to the new files',
      'Each file should ideally do one thing and be under ~300 lines',
    ],
    prompt: 'This file is too large and should be split up. Identify logical groupings and suggest how to split it into smaller, focused files. Show the refactoring plan.',
  },

  'FK-MH-DEADCODE-001': {
    what: 'There\'s a significant amount of commented-out code sitting in this file.',
    why: 'Commented-out code is confusing — is it being kept for a reason? Is it a bug waiting to happen? Git already saves your history, so there\'s no need to keep dead code around.',
    steps: [
      'Review the commented-out code: is any of it needed?',
      'If yes, uncomment it and make it work',
      'If no, delete it — git history has the backup',
      'If you\'re unsure, create a git branch to save it, then delete from main',
    ],
    prompt: 'This file has blocks of commented-out code. Remove the dead code (git has the history). If any of it is needed, uncomment and fix it. Show the cleanup.',
  },

  'FK-MH-DUPLICATION-001': {
    what: 'There are functions with very similar names or logic — likely copy-pasted code.',
    why: 'When you fix a bug in one copy, you have to remember to fix all the others too. You won\'t remember. Bugs will hide in the copies.',
    steps: [
      'Compare the similar functions: what differs between them?',
      'Extract the shared logic into a single function with parameters for the differences',
      'Replace all copies with calls to the shared function',
      'Test all the places that used the old functions',
    ],
    prompt: 'These functions contain duplicated logic. Extract the common code into a shared function with parameters for the differences. Show the refactoring.',
  },

  'FK-MH-ABSTRACTION-001': {
    what: 'This function is a thin wrapper that just calls another function — it adds complexity without adding value.',
    why: 'Extra layers of abstraction that don\'t add logic make the code harder to follow. Readers have to jump through more files to understand what\'s happening.',
    steps: [
      'Check if the wrapper adds any real logic (validation, caching, logging)',
      'If it\'s truly just a pass-through, delete the wrapper and call the inner function directly',
      'Update all callers to use the direct call',
    ],
    prompt: 'This function is a trivial wrapper around another function. Remove the unnecessary abstraction and call the inner function directly. Show the cleanup.',
  },

  // ── Testing ────────────────────────────────────────
  'FK-TV-COVERAGE-001': {
    what: 'Your project has very few tests (or none at all) compared to the amount of code.',
    why: 'Without tests, every code change is a gamble. You won\'t know if you broke something until a user reports it.',
    steps: [
      'Start with the most critical paths: auth, payments, data saving',
      'Write one test per feature: "user can log in", "user can save data"',
      'Use your framework\'s testing tools (pytest for Python, jest for JS)',
      'Aim for at least one test per API endpoint',
    ],
    prompt: 'This project needs more test coverage. Write tests for the most critical code paths (authentication, data persistence, core features). Show the test files.',
  },

  'FK-TV-RUNTIME-001': {
    what: 'Critical files (auth, payments, API routes) have no corresponding test files.',
    why: 'The most important parts of your app are untested. If auth breaks, everyone gets locked out. If payments break, you lose money.',
    steps: [
      'Create a test file for each critical module',
      'Write at least: 1 happy path test, 1 error case test, 1 edge case test',
      'For API routes: test the full request/response cycle',
      'Run tests before every deployment',
    ],
    prompt: 'These critical files have no tests. Create test files with happy path, error, and edge case tests. Show the test implementations.',
  },

  'FK-TV-CONSOLE-001': {
    what: 'There are console.error statements used as the only form of error handling.',
    why: 'console.error only prints to the browser console — users never see it, and you can\'t monitor it. The error is effectively ignored.',
    steps: [
      'Replace console.error with proper error handling (throw, return error state, show UI error)',
      'If you need logging, use a logging service (Sentry, LogRocket) that alerts you',
      'Keep console.error only as a supplement to real error handling, not a replacement',
    ],
    prompt: 'This code relies on console.error for error handling instead of proper error states. Replace with user-facing error handling and a logging service. Show the changes.',
  },

  // ── DevOps & Deployment ────────────────────────────
  'FK-DO-SETUP-001': {
    what: 'Your project is missing basic setup files like a README or lockfile.',
    why: 'Other developers (or future you) can\'t set up the project. No lockfile means npm/pip install gives different versions on different machines.',
    steps: [
      'Create a README.md with: what the project does, how to set it up, how to run it',
      'Run npm install or pip freeze to generate a lockfile',
      'Commit both files to your repository',
    ],
    prompt: 'This project is missing a README and/or lockfile. Create a README.md with setup instructions and ensure the lockfile is committed. Show the files.',
  },

  'FK-DO-ENV-001': {
    what: 'There\'s no .env.example file showing what environment variables are needed.',
    why: 'New developers have to guess what env vars to set. They\'ll misconfigure the project and waste hours debugging "connection refused" errors.',
    steps: [
      'Create a .env.example file listing all required environment variables',
      'Use placeholder values: DATABASE_URL=postgresql://user:pass@localhost:5432/mydb',
      'Add comments explaining each variable: # JWT signing secret (generate with openssl rand -hex 32)',
      'Add .env.example to git (but NOT .env itself)',
    ],
    prompt: 'Create a .env.example file documenting all required environment variables with placeholder values and explanatory comments. Show the file.',
  },

  'FK-DO-ENV-002': {
    what: 'Environment variables are referenced in code but might not be defined.',
    why: 'If an env var is missing, your app crashes with an unhelpful "undefined" error on startup — or worse, it runs with missing config and breaks later.',
    steps: [
      'Check all process.env / os.environ references in your code',
      'Validate that all required env vars exist at startup',
      'Crash immediately with a clear message if any are missing',
      'Document all env vars in .env.example',
    ],
    prompt: 'Environment variables are used in code without validation. Add startup checks that verify all required env vars are set and fail fast with clear error messages. Show the implementation.',
  },

  'FK-DO-CI-001': {
    what: 'There\'s no CI/CD configuration — tests and deploys aren\'t automated.',
    why: 'Without CI, nobody runs the tests. Bugs slip through to production because "it works on my machine" isn\'t good enough.',
    steps: [
      'Create a GitHub Actions workflow (.github/workflows/ci.yml)',
      'At minimum: install deps, run linter, run tests on every push/PR',
      'Optionally: add deployment step for merged PRs to main',
    ],
    prompt: 'Set up a CI/CD pipeline with GitHub Actions that runs tests and linting on every push. Show the workflow file.',
  },

  'FK-DO-LOGS-001': {
    what: 'Your app uses console.log/print instead of a real logging system.',
    why: 'In production, console.log disappears into the void. A proper logger lets you search logs, set severity levels, and get alerts when things break.',
    steps: [
      'Choose a logging library: winston/pino (Node), loguru/structlog (Python)',
      'Replace console.log with logger.info, logger.error, etc.',
      'Add context: logger.info("User created", { userId, email })',
      'In production, send logs to a service (CloudWatch, Datadog, etc.)',
    ],
    prompt: 'Replace console.log/print statements with a proper logging library. Add structured logging with appropriate levels (info, warn, error). Show the setup and changes.',
  },
};

/**
 * Get beginner-friendly explanation for a rule.
 * Returns undefined if no explanation exists (shouldn't happen for known rules).
 */
export function getExplanation(ruleId: string): RuleExplain | undefined {
  return explanations[ruleId];
}

/**
 * Generate a copy-paste AI prompt for a specific finding.
 * Includes file path, code context, and beginner-friendly instructions.
 */
export function getFindingPrompt(finding: { ruleId: string; title: string; location: { file: string; startLine?: number }; codeSnippet?: string; suggestedFix?: string }): string {
  const explain = explanations[finding.ruleId];
  const loc = finding.location.file + (finding.location.startLine ? `:${finding.location.startLine}` : '');

  if (explain) {
    return `Fix this issue in ${loc}:

${explain.prompt}

${finding.codeSnippet ? `Here's the current code:\n\`\`\`\n${finding.codeSnippet}\n\`\`\`` : ''}

Keep the fix simple and minimal. Don't refactor unrelated code.`;
  }

  // Fallback for unknown rules
  return `Fix this issue in ${loc}: ${finding.title}.${finding.suggestedFix ? ' ' + finding.suggestedFix : ''}${finding.codeSnippet ? `\n\nCurrent code:\n\`\`\`\n${finding.codeSnippet}\n\`\`\`` : ''}`;
}
