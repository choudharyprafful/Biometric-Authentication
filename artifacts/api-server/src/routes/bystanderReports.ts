import { Router, type IRouter, type Response } from "express";
import {
  ReportContentShowingMeBody,
  ReportContentShowingMeResponse,
  ListBystanderReportsResponse,
  FindUploadsForBystanderReportQueryParams,
  FindUploadsForBystanderReportResponse,
  PauseUploadForBystanderReportParams,
  PauseUploadForBystanderReportBody,
  PauseUploadForBystanderReportResponse,
  ResolveBystanderReportParams,
  ResolveBystanderReportBody,
  ResolveBystanderReportResponse,
} from "@workspace/api-zod";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { actorFor, type Role } from "../lib/requestActor";
import { checkAndRecordRequest } from "../lib/rateLimit";
import { getClientIp } from "../lib/clientIp";
import {
  receiveReport,
  listReports,
  candidateUploads,
  pauseForReport,
  resolveReport,
  ReportNotFoundError,
  ReportStateError,
  ReportInputError,
} from "../lib/bystanderReports";

// Team 2's Bystander Consent Policy, section 6: someone who appears in another person's upload can
// object without an account. Reporting is open to anyone; the queue is for staff, and the decisions
// (which file, pause it, remove it) are administrators', as with the other privacy registers.
const router: IRouter = Router();

const STAFF: Role[] = ["security_analyst", "admin"];
const ADMIN: Role[] = ["admin"];
const staffGates = [requireParentConsent, requireMfaEnrolled];
const staffRateLimit = requestRateLimit("bystander-reports", 60, 5 * 60 * 1000);

// A public form needs its own limits: per network, and for everyone together, so a flood can't
// bury the staff queue. requestRateLimit is keyed by account, which a public form doesn't have.
const HOUR_MS = 60 * 60 * 1000;
const REPORTS_PER_NETWORK_PER_HOUR = 5;
const REPORTS_PER_HOUR = 100;

const idParam = (raw: string | string[] | undefined) => ({ id: Number(raw) });

function answered(err: unknown, res: Response): boolean {
  if (err instanceof ReportNotFoundError) {
    res.status(404).json({ error: "No such report" });
  } else if (err instanceof ReportStateError) {
    res.status(409).json({ error: "This report is already matched or closed" });
  } else if (err instanceof ReportInputError) {
    res.status(400).json({ error: err.message });
  } else {
    return false;
  }
  return true;
}

// ── Anyone ───────────────────────────────────────────────────────────────────────────────────────

router.post("/bystander-reports", async (req, res): Promise<void> => {
  const ip = getClientIp(req);
  const perNetwork = checkAndRecordRequest(
    `bystander-report:ip:${ip}`,
    REPORTS_PER_NETWORK_PER_HOUR,
    HOUR_MS,
  );
  const overall = perNetwork.allowed
    ? checkAndRecordRequest("bystander-report:all", REPORTS_PER_HOUR, HOUR_MS)
    : perNetwork;
  if (!perNetwork.allowed || !overall.allowed) {
    res.status(429).json({
      error:
        "Too many reports have been sent from here recently. Please try again in an hour.",
    });
    return;
  }
  const body = ReportContentShowingMeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error:
        "Give your email, who you are to the content, what you're asking for, and a description of it",
    });
    return;
  }
  const report = await receiveReport(body.data, {
    ip,
    userAgent: req.headers["user-agent"],
  });
  res.status(201).json(
    ReportContentShowingMeResponse.parse({
      reference: report.id,
      receivedAt: report.receivedAt,
    }),
  );
});

// ── Staff ────────────────────────────────────────────────────────────────────────────────────────

router.get(
  "/bystander-reports",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    if (!(await actorFor(req, res, STAFF))) return;
    res.json(ListBystanderReportsResponse.parse(await listReports()));
  },
);

router.get(
  "/bystander-reports/candidate-uploads",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    if (!(await actorFor(req, res, ADMIN))) return;
    const query = FindUploadsForBystanderReportQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Give the uploader's email" });
      return;
    }
    res.json(
      FindUploadsForBystanderReportResponse.parse(
        await candidateUploads(query.data.email),
      ),
    );
  },
);

router.post(
  "/bystander-reports/:id/pause",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, ADMIN);
    if (!actor) return;
    const params = PauseUploadForBystanderReportParams.safeParse(
      idParam(req.params["id"]),
    );
    const body = PauseUploadForBystanderReportBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "No such report" });
      return;
    }
    if (!body.success) {
      res.status(400).json({
        error: "Give the file's number and why it matches the report",
      });
      return;
    }
    try {
      res.json(
        PauseUploadForBystanderReportResponse.parse(
          await pauseForReport(
            params.data.id,
            body.data.uploadId,
            body.data.note,
            actor,
          ),
        ),
      );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

router.post(
  "/bystander-reports/:id/resolve",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, ADMIN);
    if (!actor) return;
    const params = ResolveBystanderReportParams.safeParse(
      idParam(req.params["id"]),
    );
    const body = ResolveBystanderReportBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "No such report" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Choose an outcome and say why" });
      return;
    }
    try {
      res.json(
        ResolveBystanderReportResponse.parse(
          await resolveReport(
            params.data.id,
            body.data.outcome,
            body.data.note,
            actor,
          ),
        ),
      );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

export default router;
