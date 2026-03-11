/**
 * Purpose Alignment Plan
 * Takes promise-vs-reality gaps and generates a concrete implementation
 * plan to get the project back on track toward its original purpose.
 */

import type { PromiseReality, FeatureClaim } from './promise-reality.js';
import type { Finding } from '../types/index.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GapPlan {
  feature: string;
  status: FeatureClaim['status'];
  priority: 'must-have' | 'should-have' | 'nice-to-have';
  whyItMatters: string;
  implementationGuide: string[];
  techHints: string[];
  prompt: string;
  estimatedEffort: string;
}

export interface PurposePlan {
  projectPurpose: string;
  realityScore: number;
  verdict: string;
  gaps: GapPlan[];
  quickWins: GapPlan[];
  bigLifts: GapPlan[];
  summary: string;
}

// What each feature category means to end users, why it matters, and how to build it
const featureGuidance: Record<string, {
  whyItMatters: string;
  priority: GapPlan['priority'];
  missingGuide: string[];
  stubGuide: string[];
  partialGuide: string[];
  techHints: Record<string, string[]>;
  effort: { missing: string; stub: string; partial: string };
}> = {
  auth: {
    whyItMatters: 'Without auth, anyone can access everything. Users can\'t have their own accounts, data, or privacy. This is table stakes for any real app.',
    priority: 'must-have',
    missingGuide: [
      'Pick an auth provider (NextAuth, Clerk, Supabase Auth, or Firebase Auth are easiest)',
      'Set up sign-up and login pages with email/password at minimum',
      'Create a session/token system so the server knows who is making each request',
      'Protect all API routes — reject requests without a valid session',
      'Add a "current user" context that all pages and API routes can access',
    ],
    stubGuide: [
      'You have auth scaffolding but it\'s not functional — focus on the session flow',
      'Make sure login actually creates a persistent session (cookie or JWT)',
      'Verify sign-up stores credentials securely (hashed passwords, never plaintext)',
      'Wire the session check into your API middleware so every route is protected by default',
    ],
    partialGuide: [
      'Auth exists but has gaps — find which routes are unprotected and add middleware',
      'Check that token expiry and refresh are handled (users shouldn\'t get randomly logged out)',
      'Verify logout actually destroys the session server-side, not just client-side',
    ],
    techHints: {
      nextjs: ['Use NextAuth.js (next-auth) — it handles OAuth, sessions, and JWT out of the box', 'Protect API routes with getServerSession() in each route handler'],
      react: ['Use a context provider for auth state', 'Store JWT in httpOnly cookies, not localStorage'],
      fastapi: ['Use Depends(get_current_user) on every route', 'Use python-jose for JWT token handling'],
      express: ['Use passport.js or a custom JWT middleware', 'Set httpOnly, secure, sameSite cookies'],
    },
    effort: { missing: '4-8 hours', stub: '2-4 hours', partial: '1-2 hours' },
  },
  authz: {
    whyItMatters: 'Auth tells you WHO someone is. Authorization tells you WHAT they can do. Without it, every logged-in user is an admin.',
    priority: 'should-have',
    missingGuide: [
      'Define your roles (e.g., admin, member, viewer) in a central place',
      'Add a role field to your user model/table',
      'Create a middleware/decorator that checks the user\'s role before allowing access',
      'Identify which actions need elevated permissions (delete, admin panel, user management)',
      'Default new users to the lowest permission level',
    ],
    stubGuide: [
      'You have role definitions but they\'re not enforced — wire them into route handlers',
      'Make sure role checks happen server-side, not just in the UI',
    ],
    partialGuide: [
      'Check that role enforcement is consistent across all protected routes',
      'Verify that users can\'t escalate their own permissions via API calls',
    ],
    techHints: {
      nextjs: ['Check roles in middleware.ts or in each API route handler'],
      fastapi: ['Create a Depends() that checks user.role against required permissions'],
      express: ['Create an authorize(role) middleware: (req, res, next) => ...'],
    },
    effort: { missing: '3-5 hours', stub: '1-2 hours', partial: '1 hour' },
  },
  realtime: {
    whyItMatters: 'If your app promises live updates (chat, notifications, dashboards), users expect to see changes instantly without refreshing the page.',
    priority: 'should-have',
    missingGuide: [
      'Choose your approach: WebSockets (two-way), Server-Sent Events (one-way), or polling (simplest)',
      'For most apps, SSE or a service like Pusher/Ably is simplest to set up',
      'Create a server endpoint that streams updates to connected clients',
      'On the client, subscribe to the stream and update the UI when data arrives',
      'Handle reconnection — connections drop, your app needs to recover gracefully',
    ],
    stubGuide: [
      'You have WebSocket/SSE scaffolding — make sure the server actually pushes real data',
      'Test with two browser tabs: change data in one, verify it appears in the other',
    ],
    partialGuide: [
      'Real-time works for some features but not others — identify the gaps',
      'Add error handling for dropped connections and automatic reconnection',
    ],
    techHints: {
      nextjs: ['Use Vercel AI SDK\'s useChat/streamText for AI streaming', 'For general real-time, consider Pusher or Ably'],
      react: ['Use EventSource API for SSE, or socket.io-client for WebSockets'],
      fastapi: ['Use StreamingResponse for SSE or websockets module for WS'],
    },
    effort: { missing: '4-8 hours', stub: '2-3 hours', partial: '1-2 hours' },
  },
  search: {
    whyItMatters: 'If users can\'t find things, they can\'t use your app. Search and filtering are essential once you have more than a handful of items.',
    priority: 'should-have',
    missingGuide: [
      'Start with simple database LIKE/ILIKE queries — don\'t over-engineer with Elasticsearch on day 1',
      'Add a search input component that debounces input (300ms) before querying',
      'Create an API endpoint that accepts a search query and returns filtered results',
      'Add filters for common fields (status, date range, category)',
      'Show "No results" state and suggest clearing filters',
    ],
    stubGuide: [
      'Search UI exists but doesn\'t query real data — wire it to your API',
      'Make sure the backend actually filters results, not just returning everything',
    ],
    partialGuide: [
      'Search works but may be slow or inaccurate — add database indexes on searched columns',
      'Consider adding fuzzy matching or search suggestions',
    ],
    techHints: {
      nextjs: ['Use searchParams in page.tsx for server-side filtering'],
      react: ['Use useDeferredValue or debounce for search input performance'],
      fastapi: ['Use SQLAlchemy .filter() with ilike() for case-insensitive search'],
    },
    effort: { missing: '3-5 hours', stub: '1-2 hours', partial: '1 hour' },
  },
  upload: {
    whyItMatters: 'File uploads (images, documents, attachments) are a core feature for most apps. Without them, users can\'t share or store files.',
    priority: 'should-have',
    missingGuide: [
      'Choose storage: local filesystem (dev only), S3/R2 (production), or Vercel Blob/Supabase Storage',
      'Create an upload API endpoint that accepts multipart form data',
      'Add file type validation (only allow expected types like images, PDFs)',
      'Add file size limits (10MB is reasonable for most apps)',
      'Generate unique filenames to prevent overwrites and path traversal attacks',
      'Return the file URL after upload so the frontend can display/link to it',
    ],
    stubGuide: [
      'Upload scaffolding exists — verify files actually persist to storage',
      'Check that uploaded files are retrievable after server restart',
    ],
    partialGuide: [
      'Upload works but may lack validation — add type checking and size limits',
      'Verify cleanup: are orphaned files deleted when the parent record is removed?',
    ],
    techHints: {
      nextjs: ['Use Vercel Blob or next-s3-upload for easy file handling'],
      react: ['Use react-dropzone for drag-and-drop upload UI'],
      fastapi: ['Use UploadFile parameter type with python-multipart'],
      express: ['Use multer middleware for multipart/form-data parsing'],
    },
    effort: { missing: '3-5 hours', stub: '1-2 hours', partial: '1 hour' },
  },
  export: {
    whyItMatters: 'Users need to get their data OUT of your app — for reports, backups, or moving to another tool. Data export builds trust.',
    priority: 'nice-to-have',
    missingGuide: [
      'Start with CSV export — it\'s the simplest and most universal format',
      'Create an API endpoint that queries data and streams it as a CSV response',
      'Set Content-Disposition header to trigger a file download in the browser',
      'Add a "Download" or "Export" button in the UI that calls this endpoint',
      'For PDFs, consider a library like pdfkit, jsPDF, or a headless browser approach',
    ],
    stubGuide: ['Export function exists but returns empty or dummy data — wire it to real queries'],
    partialGuide: ['Export works for some data types — extend to cover all major entities'],
    techHints: {
      nextjs: ['Return a Response with CSV content-type and Content-Disposition header'],
      react: ['Use Blob + createObjectURL for client-side file generation'],
      fastapi: ['Use StreamingResponse with CSV writer for large datasets'],
    },
    effort: { missing: '2-4 hours', stub: '1-2 hours', partial: '1 hour' },
  },
  import: {
    whyItMatters: 'Bulk import lets users bring existing data into your app instead of entering it one by one. Critical for onboarding.',
    priority: 'nice-to-have',
    missingGuide: [
      'Support CSV import as a minimum — it\'s what everyone can produce',
      'Create a file upload endpoint specifically for import files',
      'Parse the CSV server-side, validate each row, and show a preview before importing',
      'Handle errors gracefully — show which rows failed and why',
      'Use database transactions so a failed import doesn\'t leave partial data',
    ],
    stubGuide: ['Import UI exists but doesn\'t process data — add CSV parsing and database insertion'],
    partialGuide: ['Import works but may lack validation — add row-level error reporting'],
    techHints: {
      nextjs: ['Use papaparse for CSV parsing'],
      fastapi: ['Use csv.DictReader with UploadFile'],
    },
    effort: { missing: '4-6 hours', stub: '2-3 hours', partial: '1-2 hours' },
  },
  payment: {
    whyItMatters: 'If your app charges money, payment integration is make-or-break. Broken payments = no revenue.',
    priority: 'must-have',
    missingGuide: [
      'Use Stripe — it\'s the standard for a reason. Create an account at stripe.com',
      'Install the Stripe SDK and set up API keys in environment variables',
      'Create a checkout endpoint that creates a Stripe Checkout Session',
      'Handle webhooks to confirm payment and update your database',
      'NEVER trust client-side payment confirmation — always verify via webhook',
      'Add a billing/subscription page where users can manage their plan',
    ],
    stubGuide: [
      'Stripe is referenced but not functional — focus on the webhook handler',
      'Make sure checkout creates real Stripe sessions, not mock ones',
    ],
    partialGuide: [
      'Payments work but may lack edge cases — handle failed payments, refunds, and plan changes',
      'Verify webhook signature validation is in place (stripe.webhooks.constructEvent)',
    ],
    techHints: {
      nextjs: ['Use @stripe/stripe-js on client, stripe on server', 'Set up a webhook endpoint at /api/webhooks/stripe'],
      fastapi: ['Use stripe Python package', 'Verify webhook signatures with stripe.Webhook.construct_event()'],
    },
    effort: { missing: '6-10 hours', stub: '3-5 hours', partial: '2-3 hours' },
  },
  email: {
    whyItMatters: 'Email is how your app communicates with users — password resets, notifications, receipts. Without it, users are locked out on day one.',
    priority: 'should-have',
    missingGuide: [
      'Choose a provider: Resend (simplest), SendGrid, or Postmark',
      'Set up API keys in environment variables',
      'Create email templates for your key flows: welcome, password reset, notifications',
      'Create a send-email utility function that all parts of your app can use',
      'Handle email failures gracefully — queue and retry, don\'t crash the request',
    ],
    stubGuide: ['Email code exists but doesn\'t send — verify API keys are set and the provider is configured'],
    partialGuide: ['Some emails work — identify which flows are missing (password reset? notifications?)'],
    techHints: {
      nextjs: ['Use Resend with react-email for beautiful, typed email templates'],
      fastapi: ['Use fastapi-mail or the sendgrid/resend Python SDK'],
    },
    effort: { missing: '2-4 hours', stub: '1 hour', partial: '30 minutes' },
  },
  chat: {
    whyItMatters: 'If your app promises messaging or chat, users expect to send and receive messages in real-time with history.',
    priority: 'should-have',
    missingGuide: [
      'Design your data model: conversations, messages, participants',
      'Create API endpoints for: list conversations, get messages, send message',
      'Add real-time updates so new messages appear without refreshing (WebSocket/SSE)',
      'Build the chat UI: message list, input box, conversation sidebar',
      'Handle message ordering, pagination (load older messages), and read receipts',
    ],
    stubGuide: ['Chat UI exists but messages don\'t persist — wire to database and add real-time delivery'],
    partialGuide: ['Chat works but may lack features — add typing indicators, read status, or message search'],
    techHints: {
      nextjs: ['Use Vercel AI SDK for AI chat, or Pusher/Ably for user-to-user chat'],
      react: ['Use react-virtualized for long message lists'],
    },
    effort: { missing: '8-16 hours', stub: '4-6 hours', partial: '2-4 hours' },
  },
  ai: {
    whyItMatters: 'If your app promises AI features, users expect them to actually work — not just a placeholder that says "AI-powered".',
    priority: 'must-have',
    missingGuide: [
      'Choose your AI provider: OpenAI (GPT), Anthropic, or use Vercel AI SDK for flexibility',
      'Set up API keys in environment variables (NEVER in client-side code)',
      'Create a server-side API route that calls the AI provider',
      'Stream responses to the client for a better UX (don\'t make users wait for the full response)',
      'Add rate limiting and cost controls — AI API calls cost money',
      'Handle errors: rate limits, token limits, and API downtime',
    ],
    stubGuide: [
      'AI integration is scaffolded — verify API keys are set and calls reach the provider',
      'Make sure streaming is working (not buffering the entire response before showing it)',
    ],
    partialGuide: [
      'AI features work but may need polish — add context management, conversation history, and error handling',
    ],
    techHints: {
      nextjs: ['Use Vercel AI SDK (ai package) — it handles streaming, tool calling, and multiple providers'],
      react: ['Use useChat() from ai/react for streaming chat UIs'],
      fastapi: ['Use openai or anthropic Python SDK with StreamingResponse'],
    },
    effort: { missing: '4-8 hours', stub: '2-3 hours', partial: '1-2 hours' },
  },
  dashboard: {
    whyItMatters: 'A dashboard gives users (and admins) an overview of what\'s happening. Without it, users have to dig through pages to understand the state of things.',
    priority: 'should-have',
    missingGuide: [
      'Identify the 4-6 most important metrics for your users',
      'Create API endpoints that aggregate data for each metric',
      'Build a dashboard page with cards/widgets showing each metric',
      'Add basic charts if appropriate (use recharts, chart.js, or tremor)',
      'Make it the landing page after login so users see value immediately',
    ],
    stubGuide: ['Dashboard page exists but shows static/dummy data — wire each widget to real API queries'],
    partialGuide: ['Dashboard works but may be incomplete — add the missing metrics and date range filters'],
    techHints: {
      nextjs: ['Use tremor or recharts for charts', 'Use server components to fetch data efficiently'],
      react: ['Use recharts or nivo for data visualization'],
    },
    effort: { missing: '4-8 hours', stub: '2-3 hours', partial: '1-2 hours' },
  },
  api: {
    whyItMatters: 'Your API is the backbone — it\'s how the frontend talks to the backend. Broken or missing API routes mean features that simply don\'t work.',
    priority: 'must-have',
    missingGuide: [
      'List every feature in your app and identify which API routes each one needs',
      'Create CRUD routes (Create, Read, Update, Delete) for each data entity',
      'Use consistent response shapes: { data: ... } on success, { error: ... } on failure',
      'Add authentication middleware to protect all routes by default',
      'Document your API — even a simple list of routes with expected inputs/outputs helps',
    ],
    stubGuide: ['API routes are registered but return dummy data — implement the database queries'],
    partialGuide: ['Most routes work but some are incomplete — check for missing error handling and edge cases'],
    techHints: {
      nextjs: ['Use Route Handlers in app/api/ directory'],
      fastapi: ['Use APIRouter for grouping related endpoints'],
      express: ['Use express.Router() to organize routes by feature'],
    },
    effort: { missing: '4-8 hours', stub: '2-4 hours', partial: '1-2 hours' },
  },
  infra: {
    whyItMatters: 'Deployment infrastructure determines whether your app can actually reach users. Without it, your code is just sitting on your laptop.',
    priority: 'should-have',
    missingGuide: [
      'Choose a hosting platform: Vercel (easiest for Next.js), Railway, Render, or Fly.io',
      'Create a Dockerfile or use the platform\'s auto-detection',
      'Set up environment variables in your hosting platform\'s dashboard',
      'Set up CI/CD: GitHub Actions to run tests on every PR is a good start',
      'Add a health check endpoint so you know if the app is running',
    ],
    stubGuide: ['Deployment config exists but may be outdated — verify it matches your current project structure'],
    partialGuide: ['Deployment works but may lack CI/CD — add automated tests and linting on push'],
    techHints: {
      nextjs: ['Deploy to Vercel with zero config — just connect your GitHub repo'],
      fastapi: ['Use Railway or Render with a Dockerfile', 'Add a /health endpoint that returns 200'],
    },
    effort: { missing: '2-4 hours', stub: '1 hour', partial: '30 minutes' },
  },
  testing: {
    whyItMatters: 'Tests catch bugs before users do. Without tests, every code change is a gamble — you won\'t know if you broke something until a user complains.',
    priority: 'should-have',
    missingGuide: [
      'Start with integration tests for your most critical paths (auth, payments, core CRUD)',
      'Set up your test framework: Jest/Vitest for JS/TS, pytest for Python',
      'Write one test per API route: does it return the right data? Does it reject bad input?',
      'Add a test script to package.json/pyproject.toml so running tests is one command',
      'Don\'t aim for 100% coverage — test the paths that would hurt most if they broke',
    ],
    stubGuide: ['Test files exist but tests are empty or skipped — fill in the test bodies'],
    partialGuide: ['Some tests exist — identify untested critical paths (auth, payment, data mutation)'],
    techHints: {
      nextjs: ['Use Vitest or Jest with @testing-library/react', 'Test API routes with supertest or direct handler calls'],
      fastapi: ['Use pytest with TestClient from fastapi.testclient'],
    },
    effort: { missing: '4-8 hours', stub: '2-4 hours', partial: '2-3 hours' },
  },
  monitoring: {
    whyItMatters: 'If your app crashes in production and nobody notices, users leave silently. Monitoring tells you what\'s broken before users have to.',
    priority: 'nice-to-have',
    missingGuide: [
      'Add Sentry for error tracking — it\'s free for small projects and catches errors automatically',
      'Add structured logging (use pino or winston, not just console.log)',
      'Set up basic uptime monitoring (UptimeRobot is free)',
      'Log key business events (user signup, payment, error) so you can debug issues',
    ],
    stubGuide: ['Monitoring references exist but aren\'t configured — set up API keys and initialize the SDK'],
    partialGuide: ['Some monitoring exists — make sure errors are captured with context (user, route, request)'],
    techHints: {
      nextjs: ['Use @sentry/nextjs — it auto-instruments both client and server'],
      fastapi: ['Use sentry-sdk with FastAPI integration'],
    },
    effort: { missing: '1-2 hours', stub: '30 minutes', partial: '30 minutes' },
  },
  collab: {
    whyItMatters: 'Multi-tenant / team support means users can collaborate. Without it, your app is single-player.',
    priority: 'nice-to-have',
    missingGuide: [
      'Add an "organization" or "team" model that groups users together',
      'Every data record should have a team_id/org_id foreign key',
      'Scope ALL database queries to the current user\'s team — never show cross-team data',
      'Add invite flow: generate invite link/code, accept invite, join team',
      'Add team member management: list members, change roles, remove members',
    ],
    stubGuide: ['Team model exists but data isn\'t scoped — add team_id filtering to all queries'],
    partialGuide: ['Teams work but some queries may leak data across teams — audit every query'],
    techHints: {},
    effort: { missing: '8-16 hours', stub: '4-6 hours', partial: '2-4 hours' },
  },
  i18n: {
    whyItMatters: 'If your app promises multiple languages, users in other locales expect it to actually work in their language.',
    priority: 'nice-to-have',
    missingGuide: [
      'Choose an i18n library: next-intl (Next.js), react-i18next (React), or gettext (Python)',
      'Extract all user-facing strings into translation files (en.json, es.json, etc.)',
      'Replace hardcoded strings with translation function calls: t("greeting")',
      'Add a language switcher in the UI',
      'Start with 2 languages — don\'t try to support everything at once',
    ],
    stubGuide: ['i18n is set up but most strings are still hardcoded — extract them into translation files'],
    partialGuide: ['Some pages are translated — find and extract the remaining hardcoded strings'],
    techHints: {
      nextjs: ['Use next-intl with the app router for full SSR i18n support'],
      react: ['Use react-i18next with namespaced translation files'],
    },
    effort: { missing: '4-8 hours', stub: '2-4 hours', partial: '2-3 hours' },
  },
};

export function generatePurposePlan(
  promiseReality: PromiseReality,
  framework?: string,
): PurposePlan {
  const gaps: GapPlan[] = [];

  for (const claim of promiseReality.claims) {
    if (claim.status === 'implemented') continue;

    const category = findCategory(claim.claim);
    const guidance = category ? featureGuidance[category] : null;

    let guide: string[];
    let effort: string;
    if (guidance) {
      guide = claim.status === 'missing' ? guidance.missingGuide
        : claim.status === 'stub' ? guidance.stubGuide
        : guidance.partialGuide;
      effort = claim.status === 'missing' ? guidance.effort.missing
        : claim.status === 'stub' ? guidance.effort.stub
        : guidance.effort.partial;
    } else {
      guide = [`Implement ${claim.claim} based on the project requirements.`];
      effort = '2-4 hours';
    }

    // Get framework-specific tech hints
    const techHints: string[] = [];
    if (guidance?.techHints && framework) {
      const fw = framework.toLowerCase();
      for (const [key, hints] of Object.entries(guidance.techHints)) {
        if (fw.includes(key)) {
          techHints.push(...hints);
        }
      }
    }

    const statusLabel = claim.status === 'missing' ? 'not implemented at all'
      : claim.status === 'stub' ? 'stubbed out (placeholder code exists but doesn\'t work)'
      : 'partially working but has issues';

    const prompt = `The project's README promises "${claim.claim}" but it's ${statusLabel}. ${claim.evidence}\n\nImplement this feature properly. Here's what needs to happen:\n${guide.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nUse the existing patterns and conventions in this project. Show me the complete code changes needed.`;

    gaps.push({
      feature: claim.claim,
      status: claim.status,
      priority: guidance?.priority || 'should-have',
      whyItMatters: guidance?.whyItMatters || `${claim.claim} was promised in the project description and users expect it to work.`,
      implementationGuide: guide,
      techHints,
      prompt,
      estimatedEffort: effort,
    });
  }

  // Sort: must-have first, then by status (missing > stub > partial)
  const priorityOrder: Record<string, number> = { 'must-have': 0, 'should-have': 1, 'nice-to-have': 2 };
  const statusOrder: Record<string, number> = { missing: 0, stub: 1, partial: 2 };
  gaps.sort((a, b) =>
    (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
    || (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2)
  );

  const quickWins = gaps.filter(g => g.status === 'partial' || g.status === 'stub');
  const bigLifts = gaps.filter(g => g.status === 'missing');

  let summary: string;
  if (gaps.length === 0) {
    summary = 'All promised features are implemented. Focus on quality and polish.';
  } else {
    const mustHaves = gaps.filter(g => g.priority === 'must-have');
    if (mustHaves.length > 0) {
      summary = `${mustHaves.length} must-have feature${mustHaves.length > 1 ? 's' : ''} ${mustHaves.length > 1 ? 'need' : 'needs'} work: ${mustHaves.map(g => g.feature).join(', ')}. Start here to fulfill your project's core promise.`;
    } else {
      summary = `${gaps.length} promised feature${gaps.length > 1 ? 's' : ''} ${gaps.length > 1 ? 'need' : 'needs'} work. The core is there — focus on closing the gaps.`;
    }
  }

  return {
    projectPurpose: promiseReality.projectPurpose,
    realityScore: promiseReality.realityScore,
    verdict: promiseReality.verdict,
    gaps,
    quickWins,
    bigLifts,
    summary,
  };
}

function findCategory(claimLabel: string): string | null {
  const map: Record<string, string> = {
    'Authentication / Login': 'auth',
    'Authorization / Roles': 'authz',
    'Real-time Updates': 'realtime',
    'Search / Filtering': 'search',
    'File Upload': 'upload',
    'Data Export': 'export',
    'Data Import': 'import',
    'Payments / Billing': 'payment',
    'Email / Notifications': 'email',
    'Chat / Messaging': 'chat',
    'AI / Machine Learning': 'ai',
    'Dashboard / Admin': 'dashboard',
    'API': 'api',
    'Deployment / Infrastructure': 'infra',
    'Testing': 'testing',
    'Monitoring / Analytics': 'monitoring',
    'Teams / Multi-tenant': 'collab',
    'Internationalization': 'i18n',
  };
  return map[claimLabel] || null;
}

export function exportPurposePlan(plan: PurposePlan, outputDir: string): string {
  let md = `# Get Back on Track: Purpose Alignment Plan\n\n`;
  md += `> **Project purpose:** ${plan.projectPurpose}\n\n`;
  md += `> **Reality Score:** ${plan.realityScore}% — ${plan.verdict}\n\n`;
  md += `${plan.summary}\n\n---\n\n`;

  if (plan.gaps.length === 0) {
    md += `All features are implemented. Nice work.\n`;
  }

  // Group by priority
  for (const priority of ['must-have', 'should-have', 'nice-to-have'] as const) {
    const group = plan.gaps.filter(g => g.priority === priority);
    if (group.length === 0) continue;

    const label = priority === 'must-have' ? 'Must-Have (Start Here)'
      : priority === 'should-have' ? 'Should-Have (Do Next)'
      : 'Nice-to-Have (When You Have Time)';

    md += `## ${label}\n\n`;

    for (const gap of group) {
      const statusTag = gap.status === 'missing' ? 'MISSING'
        : gap.status === 'stub' ? 'STUB'
        : 'PARTIAL';

      md += `### ${gap.feature} [${statusTag}]\n\n`;
      md += `**Why it matters:** ${gap.whyItMatters}\n\n`;
      md += `**Estimated effort:** ${gap.estimatedEffort}\n\n`;
      md += `**How to implement:**\n`;
      for (const step of gap.implementationGuide) {
        md += `- [ ] ${step}\n`;
      }
      md += `\n`;

      if (gap.techHints.length > 0) {
        md += `**Framework tips:**\n`;
        for (const hint of gap.techHints) {
          md += `- ${hint}\n`;
        }
        md += `\n`;
      }

      md += `**AI Prompt:**\n\`\`\`\n${gap.prompt}\n\`\`\`\n\n`;
    }
  }

  const path = join(outputDir, 'flaw-purpose-plan.md');
  writeFileSync(path, md);
  return path;
}
