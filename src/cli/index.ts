#!/usr/bin/env node
import { createPool } from "../storage/postgres/connection.js";
import { OpenPayablesStore } from "../storage/postgres/repository.js";
import type { AwardSize } from "../core/credits.js";
import type { VoteChoice } from "../core/voting.js";
import { OpenPayablesFinance } from "../storage/postgres/finance.js";
import { StripeTestClient } from "../payments/stripe/test-client.js";
import { GitHubPublicClient, parseMaxPages, parsePublicRepository, parseSince } from "../github/discovery.js";
import { OpenPayablesGitHub } from "../storage/postgres/github.js";
import { GitHubAppClient } from "../github/app.js";
import { GitHubDeviceFlowClient } from "../github/device-flow.js";
import { OpenPayablesOperatorSetup } from "../operator/setup.js";
import { OpenPayablesContributorReview } from "../operator/review.js";

const HELP = `OpenPayables technical preview — operator-owned Stripe TEST only
  project setup <project-id> <project-name> <owner/repo>   (GitHub App verified; atomic local setup)
  project setup-status <project-id>                     (read-only local readiness)
  github source add <project-id> <owner/repo>          (public, read-only; verifies repository)
  github source list <project-id>
  github app bind <project-id> <owner/repo>         (verify App installation and bind exact repository)
  github app show <project-id> <owner/repo>         (read-only binding metadata)
  github sync <project-id> <owner/repo> <since-YYYY-MM-DD> [max-pr-pages]
  github candidates <project-id> [offset]            (all candidates, including approved)
  github review pending <project-id> [offset]        (unapproved evidence with identity status)
  github enroll <project-id> <github-user-id> <contributor-id> <display-name>  (atomic operator attestation)
  github identity link <project-id> <github-user-id> <contributor-id>  (operator attestation; immutable)
  github identity show <project-id> <contributor-id>    (read-only C8 link and C10 verification)
  github identity whoami                            (GitHub App Device Flow; no DB write)
  github identity verify <project-id> <contributor-id>  (GitHub App Device Flow; user controls linked account)
  github approve <project-id> <github-repo-id> <candidate-key> <small|medium|large> <reason>
  project create <project-id> <name>
  contributor create <contributor-id> <display-name>
  project join <project-id> <contributor-id>
  category add <project-id> <category-code> <description>
  credit award <project-id> <contributor-id> <category> <small|medium|large> <source> <source-id> <role> <approval-reason>
  credit reverse <award-uuid> <reason>
  credit balances <project-id>
  credit history <project-id>
  proposal open <project-id> <title> <description>
  proposal vote <proposal-uuid> <contributor-id> <yes|no|abstain>
  proposal tally <proposal-uuid>
  proposal close <proposal-uuid>
  fund add <project-id> <cents> <funding-reference>    (TEST attestation only)
  fund import-topup <project-id> <stripe-tu-id>         (TEST Stripe receipt; no top-up created)
  fund recheck <project-id>                             (recheck TEST receipts across same platform)
  fund status <project-id>
  distribution preview <project-id> <usd-cents>       (hypothetical, read-only; no funding or payouts)
  distribution create <project-id> <period-label> <cents>       (manual TEST/prefunded pool)
  distribution create-revenue <project-id> <period-label> <gross-cents> <fee-cents> <cost-cents> <reserve-cents> <share-bps> <policy-ref> <receipt-ref>
  distribution approve <period-uuid>
  distribution show <period-uuid>
  stripe account create <project-id> <contributor-id> <email>
  stripe onboarding link <stripe-account-id> <refresh-url> <return-url>
  stripe balance                                            (TEST platform available USD cents)
  stripe platform bind <project-id>                         (TEST, verified /account, immutable binding)
  stripe platform show <project-id>                         (read-only; no credentials shown)
  payment destination <project-id> <contributor-id> <stripe-acct-id>
  payment prepare <obligation-uuid>
  payment send <obligation-uuid>                       (Stripe TEST mode only)
  payment reconcile <obligation-uuid>
  payment history <obligation-uuid>
  payout sync <project-id> <contributor-id>             (read-only Stripe TEST fetch; auditable local observation)
  payout show <project-id> <contributor-id>             (local payout history, not obligation settlement)
  payout trace <obligation-uuid> <stripe-po-id>          (GET-only automatic payout composition; no settlement write)
Set OPENPAYABLES_DATABASE_URL to a dedicated development PostgreSQL database.
Set OPENPAYABLES_OPERATOR_ID for all write commands. Neither is read from host apps.`;

function required(parts: string[], expected: number) {
  if (parts.length !== expected || parts.some((part) => !part.trim())) throw new Error(`Expected ${expected} arguments.\n${HELP}`);
}

function operator(): string {
  const value = process.env.OPENPAYABLES_OPERATOR_ID?.trim();
  if (!value) throw new Error("Set OPENPAYABLES_OPERATOR_ID before performing write operations");
  return value;
}

async function main() {
  const [group, command, ...args] = process.argv.slice(2);
  if (!group || group === "help" || group === "--help") {
    console.log(HELP);
    return;
  }
  const pool = createPool();
  const store = new OpenPayablesStore(pool);
  const finance = new OpenPayablesFinance(pool);
  const github = new OpenPayablesGitHub(pool);
  const setup = new OpenPayablesOperatorSetup(pool);
  const review = new OpenPayablesContributorReview(pool);
  try {
    let result: unknown;
    const key = `${group} ${command}`;
    switch (key) {
      case "project setup": {
        required(args, 3);
        const actor = operator();
        const publicGitHub = new GitHubPublicClient();
        const app = GitHubAppClient.fromEnv();
        result = await setup.setup(args[0]!, args[1]!, args[2]!, actor, {
          repository: (fullName) => publicGitHub.repository(fullName),
          authorizeRepository: (repo) => app.authorizeRepository(repo),
        });
        break;
      }
      case "project setup-status":
        required(args, 1);
        result = await setup.status(args[0]!);
        break;
      case "github source":
        if (args[0] === "add") {
          required(args, 3); operator();
          const publicClient = new GitHubPublicClient();
          result = await github.registerSource(args[1]!, await publicClient.repository(args[2]!), operator());
        } else if (args[0] === "list") {
          required(args, 2); result = await github.sources(args[1]!);
        } else throw new Error(HELP);
        break;
      case "github app": {
        if (args[0] !== "bind" && args[0] !== "show") throw new Error(HELP);
        required(args, 3);
        const source = await github.requireSource(args[1]!, args[2]!);
        if (args[0] === "show") {
          result = { projectId: args[1], repo: source.fullName,
            binding: await github.appBinding(args[1]!, source.id) };
        } else {
          const actor = operator();
          const session = await GitHubAppClient.fromEnv().authorizeRepository(source);
          result = await github.bindAppInstallation(args[1]!, source, session, actor);
        }
        break;
      }
      case "github sync": {
        if (args.length !== 3 && args.length !== 4) throw new Error(HELP);
        operator();
        parsePublicRepository(args[1]!);
        const since = parseSince(args[2]!);
        const maxPages = parseMaxPages(args[3]);
        const saved = await github.requireSource(args[0]!, args[1]!);
        const binding = await github.appBinding(args[0]!, saved.id);
        // Once bound, an App installation must remain valid: never silently fall back to public access.
        const session = binding ? await GitHubAppClient.fromEnv().authorizeRepository(saved, binding) : null;
        const publicClient = session ? new GitHubPublicClient(fetch, session.token) : new GitHubPublicClient();
        const current = await publicClient.repository(saved.fullName);
        if (current.id !== saved.id) throw new Error("GitHub source ID mismatch; refusing import");
        const found = await publicClient.discover(current, since, maxPages);
        result = { ...(await github.importCandidates(args[0]!, current, found)),
          sinceUtc: since, maxPages, authMode: binding ? "github_app_installation" : "public",
          installationId: binding?.installationId ?? null };
        break;
      }
      case "github identity":
        if (args[0] === "link") {
          required(args, 4);
          result = await github.linkIdentity(args[1]!, Number(args[2]), args[3]!, operator());
        } else if (args[0] === "show") {
          required(args, 3);
          result = await github.identityStatus(args[1]!, args[2]!);
        } else if (args[0] === "whoami") {
          required(args, 1);
          const appClientId = process.env.OPENPAYABLES_GITHUB_APP_CLIENT_ID ?? "";
          await GitHubAppClient.fromEnv().assertClientId(appClientId);
          const user = await new GitHubDeviceFlowClient(appClientId).authenticate((prompt) => {
            console.error(`Open ${prompt.verificationUri} in your OWN GitHub session`);
            console.error(`Enter code: ${prompt.userCode} (expires in ${prompt.expiresInSeconds} seconds)`);
            console.error("Authorize only the Mightymetrika OpenPayables App that you recognize.");
          });
          result = { ...user, verifiedBy: "github_app_device_flow", stored: false,
            note: "Authenticated GitHub ID only. No project identity is linked or verified by whoami." };
        } else if (args[0] === "verify") {
          required(args, 3);
          const actor = operator();
          const status = await github.identityStatus(args[1]!, args[2]!);
          if (!status.linked) throw new Error("Link the project contributor to discovered GitHub evidence first");
          if (status.verified) {
            result = { ...status, verifiedNow: false, note: "Already verified; no additional GitHub authorization needed" };
            break;
          }
          const appId = Number(process.env.OPENPAYABLES_GITHUB_APP_ID);
          if (!Number.isSafeInteger(appId) || appId <= 0) {
            throw new Error("Set OPENPAYABLES_GITHUB_APP_ID to the bound App's numeric ID");
          }
          const appClientId = process.env.OPENPAYABLES_GITHUB_APP_CLIENT_ID ?? "";
          await GitHubAppClient.fromEnv().assertClientId(appClientId);
          const user = await new GitHubDeviceFlowClient(appClientId).authenticate((prompt) => {
            // Print only the public user code and official URL; never print device or access tokens.
            console.error(`Contributor: open ${prompt.verificationUri} in your OWN GitHub session`);
            console.error(`Enter code: ${prompt.userCode} (expires in ${prompt.expiresInSeconds} seconds)`);
            console.error("Approve only if this is your own GitHub account and the App is Mightymetrika OpenPayables.");
          });
          result = await github.verifyIdentity(args[1]!, args[2]!,
            user.githubUserId, user.githubLogin, appId, actor);
        } else throw new Error(HELP);
        break;
      case "github enroll":
        required(args, 4);
        result = await review.enroll(args[0]!, Number(args[1]), args[2]!, args[3]!, operator());
        break;
      case "github review":
        if (args[0] !== "pending" || (args.length !== 2 && args.length !== 3)) throw new Error(HELP);
        result = await review.pending(args[1]!, args[2] === undefined ? 0 : Number(args[2]));
        break;
      case "github approve":
        required(args, 5);
        result = await github.approveCandidate(args[0]!, Number(args[1]), args[2]!,
          args[3]! as AwardSize, args[4]!, operator());
        break;
      case "github candidates":
        if (args.length !== 1 && args.length !== 2) throw new Error(HELP);
        result = await github.candidates(args[0]!, args[1] === undefined ? 0 : Number(args[1])); break;
      case "project create":
        required(args, 2); result = await store.createProject(args[0]!, args[1]!, operator()); break;
      case "contributor create":
        required(args, 2); result = await store.createContributor(args[0]!, args[1]!); break;
      case "project join":
        required(args, 2); result = await store.joinProject(args[0]!, args[1]!); break;
      case "category add":
        required(args, 3); result = await store.addCategory(args[0]!, args[1]!, args[2]!, operator()); break;
      case "credit award":
        required(args, 8);
        result = await store.award({ projectId: args[0]!, contributorId: args[1]!,
          category: args[2]!, size: args[3]! as AwardSize, source: args[4]!,
          sourceId: args[5]!, role: args[6]!, reason: args[7]!, approvedBy: operator() });
        break;
      case "credit reverse":
        required(args, 2); result = await store.reverseAward(args[0]!, args[1]!, operator()); break;
      case "credit balances":
        required(args, 1); result = await store.balances(args[0]!); break;
      case "credit history":
        required(args, 1); result = await store.creditHistory(args[0]!); break;
      case "proposal open":
        required(args, 3); result = await store.openProposal(args[0]!, args[1]!, args[2]!, operator()); break;
      case "proposal vote":
        required(args, 3); result = await store.castVote(args[0]!, args[1]!, args[2]! as VoteChoice, operator()); break;
      case "proposal tally":
        required(args, 1); result = await store.tallyProposal(args[0]!); break;
      case "proposal close":
        required(args, 1); result = await store.closeProposal(args[0]!, operator()); break;
      case "fund add":
        required(args, 3); result = await finance.addFunding(args[0]!, Number(args[1]), args[2]!, operator()); break;
      case "fund import-topup":
        required(args, 2);
        result = await finance.importTestTopup(args[0]!, args[1]!, new StripeTestClient(), operator());
        break;
      case "fund recheck":
        required(args, 1); result = await finance.recheckProjectTestFunding(args[0]!, new StripeTestClient(), operator()); break;
      case "fund status":
        required(args, 1); result = await finance.fundingStatus(args[0]!); break;
      case "distribution preview":
        required(args, 2);
        result = await review.preview(args[0]!, Number(args[1]));
        break;
      case "distribution create":
        required(args, 3); result = await finance.createPeriod(args[0]!, args[1]!, Number(args[2]), operator()); break;
      case "distribution create-revenue":
        required(args, 9);
        result = await finance.createRevenuePeriod(args[0]!, args[1]!, {
          grossReceiptsCents: Number(args[2]), feeCents: Number(args[3]),
          costCents: Number(args[4]), reserveCents: Number(args[5]),
          contributorShareBasisPoints: Number(args[6]),
        }, args[7]!, args[8]!, operator());
        break;
      case "distribution approve":
        required(args, 1);
        result = await finance.approvePeriod(args[0]!, operator(),
          (await finance.verifiedPlatformForPeriod(args[0]!)) ? new StripeTestClient() : undefined);
        break;
      case "distribution show":
        required(args, 1); result = await finance.showPeriod(args[0]!); break;
      case "stripe balance":
        required(args, 0); result = { currency: "usd", availableCents: await new StripeTestClient().availableBalanceCents("usd") }; break;
      case "stripe platform":
        required(args, 2);
        if (args[0] === "bind") result = await finance.bindTestPlatform(args[1]!, new StripeTestClient(), operator());
        else if (args[0] === "show") result = await finance.boundTestPlatform(args[1]!);
        else throw new Error(HELP);
        break;
      case "payment destination":
        required(args, 3); result = await finance.setDestination(args[0]!, args[1]!, args[2]!, operator()); break;
      case "payment prepare":
        required(args, 1); operator(); result = await finance.prepareObligation(args[0]!, new StripeTestClient()); break;
      case "payment send":
        required(args, 1); operator(); result = await finance.submitObligation(args[0]!, new StripeTestClient()); break;
      case "payment reconcile":
        required(args, 1); operator(); result = await finance.reconcileObligation(args[0]!, new StripeTestClient()); break;
      case "payment history":
        required(args, 1); result = await finance.paymentHistory(args[0]!); break;
      case "payout sync":
        required(args, 2); result = await finance.syncConnectedPayouts(args[0]!, args[1]!, new StripeTestClient(), operator()); break;
      case "payout show":
        required(args, 2); result = await finance.connectedPayoutHistory(args[0]!, args[1]!); break;
      case "payout trace":
        required(args, 2); result = await finance.traceAutomaticPayoutForObligation(args[0]!, args[1]!, new StripeTestClient()); break;
      case "stripe account":
        if (args[0] !== "create") throw new Error(HELP);
        required(args, 4); operator();
        {
          const stripe = new StripeTestClient();
          await finance.assertTestPlatform(args[1]!, stripe);
          const account = await stripe.createExpressAccount(args[3]!);
          await finance.setDestination(args[1]!, args[2]!, account.id, operator());
          result = { accountId: account.id, projectId: args[1], contributorId: args[2] };
        }
        break;
      case "stripe onboarding":
        if (args[0] !== "link") throw new Error(HELP);
        required(args, 4); operator();
        result = await new StripeTestClient().onboardingLink(args[1]!, args[2]!, args[3]!); break;
      default: throw new Error(`Unknown command: ${key}\n${HELP}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
