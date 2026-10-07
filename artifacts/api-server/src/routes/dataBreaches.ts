import { Router, type IRouter, type Response } from "express";
import {
  ListMyBreachNoticesResponse,
  AcknowledgeBreachNoticeParams,
  AcknowledgeBreachNoticeResponse,
  ListDataBreachesResponse,
  RecordDataBreachBody,
  RecordDataBreachResponse,
  AssessDataBreachParams,
  AssessDataBreachBody,
  AssessDataBreachResponse,
  NotifyDataBreachUsersParams,
  NotifyDataBreachUsersBody,
  NotifyDataBreachUsersResponse,
  RecordRegulatorNotificationParams,
  RecordRegulatorNotificationBody,
  RecordRegulatorNotificationResponse,
  ListGovernmentDisclosuresResponse,
  RecordGovernmentDisclosureBody,
  RecordGovernmentDisclosureResponse,
  ListLegalHoldsResponse,
  PlaceLegalHoldBody,
  PlaceLegalHoldResponse,
  ReleaseLegalHoldParams,
  ReleaseLegalHoldBody,
  ReleaseLegalHoldResponse,
} from "@workspace/api-zod";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { actorFor, type Role } from "../lib/requestActor";
import {
  listBreaches,
  recordBreach,
  assessBreach,
  notifyBreachUsers,
  recordRegulatorNotification,
  noticesFor,
  acknowledgeNotice,
  listDisclosures,
  recordDisclosure,
  BreachNotFoundError,
  NoticeNotFoundError,
  AlreadyRecordedError,
  RegisterInputError,
} from "../lib/dataBreaches";
import {
  listHolds,
  placeHold,
  releaseHold,
  HoldNotFoundError,
  HoldAlreadyReleasedError,
} from "../lib/legalHolds";

// The data breach register, the government disclosure record and legal holds (docs/12). Security
// analysts can record and assess a breach; telling people, telling the OAIC, recording a disclosure
// and holding someone's information are for administrators, because each is a decision made for the
// company. Legal holds are administrators' only, to read too: who is the subject of a government
// request is need-to-know.
const router: IRouter = Router();

const STAFF: Role[] = ["security_analyst", "admin"];
const ADMIN: Role[] = ["admin"];
const staffGates = [requireParentConsent, requireMfaEnrolled];
const staffRateLimit = requestRateLimit("privacy-register", 60, 5 * 60 * 1000);

const idParam = (raw: string | string[] | undefined) => ({ id: Number(raw) });

// Turns the library's errors into answers; anything else is a real failure for the error handler.
function answered(err: unknown, res: Response): boolean {
  if (err instanceof BreachNotFoundError) {
    res.status(404).json({ error: "No such breach" });
  } else if (err instanceof NoticeNotFoundError) {
    res.status(404).json({ error: "No such notice" });
  } else if (err instanceof AlreadyRecordedError) {
    res.status(409).json({
      error:
        "When the OAIC was told is already recorded, and can't be changed afterwards",
    });
  } else if (err instanceof RegisterInputError) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof HoldNotFoundError) {
    res.status(404).json({ error: "No such hold" });
  } else if (err instanceof HoldAlreadyReleasedError) {
    res.status(409).json({ error: "This hold has already been released" });
  } else {
    return false;
  }
  return true;
}

// ── The person affected ──────────────────────────────────────────────────────────────────────────

// Open to any signed-in account, like the other privacy routes: a breach notice must reach someone
// still setting up MFA or waiting for a parent.
router.get("/users/me/breach-notices", async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actor) return;
  res.json(ListMyBreachNoticesResponse.parse(await noticesFor(actor.userId)));
});

router.post(
  "/users/me/breach-notices/:id/acknowledge",
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res);
    if (!actor) return;
    const params = AcknowledgeBreachNoticeParams.safeParse(
      idParam(req.params["id"]),
    );
    if (!params.success) {
      res.status(404).json({ error: "No such notice" });
      return;
    }
    try {
      res.json(
        AcknowledgeBreachNoticeResponse.parse(
          await acknowledgeNotice(params.data.id, actor),
        ),
      );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

// ── Staff: the breach register ───────────────────────────────────────────────────────────────────

router.get(
  "/data-breaches",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    if (!(await actorFor(req, res, STAFF))) return;
    res.json(ListDataBreachesResponse.parse(await listBreaches()));
  },
);

router.post(
  "/data-breaches",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, STAFF);
    if (!actor) return;
    const body = RecordDataBreachBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error:
          "Give a title, what happened (at least 10 characters), the information involved, what people should do, and when it was discovered",
      });
      return;
    }
    try {
      res
        .status(201)
        .json(
          RecordDataBreachResponse.parse(await recordBreach(body.data, actor)),
        );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

router.post(
  "/data-breaches/:id/assess",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, STAFF);
    if (!actor) return;
    const params = AssessDataBreachParams.safeParse(idParam(req.params["id"]));
    const body = AssessDataBreachBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "No such breach" });
      return;
    }
    if (!body.success) {
      res.status(400).json({
        error:
          "Say whether serious harm is likely, and why, in 5–2,000 characters",
      });
      return;
    }
    try {
      res.json(
        AssessDataBreachResponse.parse(
          await assessBreach(params.data.id, body.data, actor),
        ),
      );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

router.post(
  "/data-breaches/:id/notify-users",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, ADMIN);
    if (!actor) return;
    const params = NotifyDataBreachUsersParams.safeParse(
      idParam(req.params["id"]),
    );
    const body = NotifyDataBreachUsersBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "No such breach" });
      return;
    }
    if (!body.success) {
      res.status(400).json({
        error: "Choose everyone, or list up to 1,000 email addresses",
      });
      return;
    }
    try {
      res.json(
        NotifyDataBreachUsersResponse.parse(
          await notifyBreachUsers(
            params.data.id,
            body.data.audience,
            body.data.emails ?? [],
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
  "/data-breaches/:id/regulator",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, ADMIN);
    if (!actor) return;
    const params = RecordRegulatorNotificationParams.safeParse(
      idParam(req.params["id"]),
    );
    const body = RecordRegulatorNotificationBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "No such breach" });
      return;
    }
    if (!body.success) {
      res.status(400).json({
        error: "Give the date the OAIC was told and its reference",
      });
      return;
    }
    try {
      res.json(
        RecordRegulatorNotificationResponse.parse(
          await recordRegulatorNotification(
            params.data.id,
            body.data.notifiedAt,
            body.data.reference,
            actor,
          ),
        ),
      );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

// ── Staff: disclosures to government agencies ────────────────────────────────────────────────────

router.get(
  "/government-disclosures",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    if (!(await actorFor(req, res, STAFF))) return;
    res.json(ListGovernmentDisclosuresResponse.parse(await listDisclosures()));
  },
);

router.post(
  "/government-disclosures",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, ADMIN);
    if (!actor) return;
    const body = RecordGovernmentDisclosureBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error:
          "Give the agency, the kind of request, the law or order relied on, what kinds of information were given, what was disclosed and when",
      });
      return;
    }
    try {
      res
        .status(201)
        .json(
          RecordGovernmentDisclosureResponse.parse(
            await recordDisclosure(body.data, actor),
          ),
        );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

// ── Administrators: legal holds ──────────────────────────────────────────────────────────────────

router.get(
  "/legal-holds",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    if (!(await actorFor(req, res, ADMIN))) return;
    res.json(ListLegalHoldsResponse.parse(await listHolds()));
  },
);

router.post(
  "/legal-holds",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, ADMIN);
    if (!actor) return;
    const body = PlaceLegalHoldBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error:
          "Give the person's email, the agency, and what the request covers",
      });
      return;
    }
    res
      .status(201)
      .json(PlaceLegalHoldResponse.parse(await placeHold(body.data, actor)));
  },
);

router.post(
  "/legal-holds/:id/release",
  ...staffGates,
  staffRateLimit,
  async (req, res): Promise<void> => {
    const actor = await actorFor(req, res, ADMIN);
    if (!actor) return;
    const params = ReleaseLegalHoldParams.safeParse(idParam(req.params["id"]));
    const body = ReleaseLegalHoldBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "No such hold" });
      return;
    }
    if (!body.success) {
      res.status(400).json({
        error: "Say why the information no longer has to be kept",
      });
      return;
    }
    try {
      res.json(
        ReleaseLegalHoldResponse.parse(
          await releaseHold(params.data.id, body.data.reason, actor),
        ),
      );
    } catch (err) {
      if (!answered(err, res)) throw err;
    }
  },
);

export default router;
