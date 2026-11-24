import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  requireDb,
  schoolsTable,
  teacherProfilesTable,
  verificationRecordsTable,
} from "@workspace/db";

export type Stage = "IDENTITY" | "PROFESSIONAL";
export type StageStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "NEEDS_MORE_INFORMATION"
  | "VERIFIED"
  | "REJECTED"
  | "EXPIRED";

export type StageState = {
  stage: Stage;
  status: StageStatus;
  recordId: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  feedback: string | null;
  expiresAt: Date | null;
  schoolId: string | null;
};

const emptyStage = (stage: Stage): StageState => ({
  stage,
  status: "NOT_STARTED",
  recordId: null,
  submittedAt: null,
  reviewedAt: null,
  feedback: null,
  expiresAt: null,
  schoolId: null,
});

/** Latest submission per stage. A verified record past its expiry counts as EXPIRED. */
export async function getTeacherStages(userId: string) {
  const rows = await requireDb()
    .select()
    .from(verificationRecordsTable)
    .where(
      and(
        eq(verificationRecordsTable.userId, userId),
        eq(verificationRecordsTable.type, "TEACHER"),
        isNotNull(verificationRecordsTable.stage),
      ),
    )
    .orderBy(desc(verificationRecordsTable.createdAt), desc(verificationRecordsTable.id));
  const stages: Record<Stage, StageState> = {
    IDENTITY: emptyStage("IDENTITY"),
    PROFESSIONAL: emptyStage("PROFESSIONAL"),
  };
  const seen = new Set<Stage>();
  for (const row of rows) {
    const stage = row.stage as Stage;
    if (seen.has(stage)) continue;
    seen.add(stage);
    const expired =
      row.status === "VERIFIED" && row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();
    stages[stage] = {
      stage,
      status: expired ? "EXPIRED" : row.status,
      recordId: row.id,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      feedback: row.reviewerFeedback,
      expiresAt: row.expiresAt,
      schoolId: row.schoolId,
    };
  }
  return stages;
}

/**
 * The single source of truth for "is this teacher fully verified?".
 * Both the publishing gate and the public "Verified teacher" badge use it.
 *
 * A teacher is verified only when ALL hold:
 *  - the latest IDENTITY record is VERIFIED and unexpired
 *  - the latest PROFESSIONAL record is VERIFIED, unexpired, and confirms the
 *    teacher's CURRENT school (changing school requires re-verification)
 *  - that school is ACTIVE in the administrator-managed directory
 */
export async function verifiedTeacherIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const result = await requireDb().execute<{ user_id: string }>(sql`
    with latest as (
      select distinct on (user_id, stage) user_id, stage, status, expires_at, school_id
      from verification_records
      where type = 'TEACHER' and stage is not null
        and user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})
      order by user_id, stage, created_at desc, id desc
    )
    select tp.user_id
    from teacher_profiles tp
    join schools s on s.id = tp.school_id and s.status = 'ACTIVE'
    join latest i on i.user_id = tp.user_id and i.stage = 'IDENTITY'
      and i.status = 'VERIFIED' and (i.expires_at is null or i.expires_at > now())
    join latest p on p.user_id = tp.user_id and p.stage = 'PROFESSIONAL'
      and p.status = 'VERIFIED' and (p.expires_at is null or p.expires_at > now())
      and p.school_id = tp.school_id
  `);
  return new Set(result.rows.map((row) => row.user_id));
}

export type Eligibility = {
  eligible: boolean;
  reasons: string[];
  stages: Record<Stage, StageState>;
  schoolId: string | null;
  schoolName: string | null;
  schoolStatus: string | null;
};

export async function getTeacherEligibility(userId: string): Promise<Eligibility> {
  const [stages, verified, [profile]] = await Promise.all([
    getTeacherStages(userId),
    verifiedTeacherIds([userId]),
    requireDb()
      .select({ schoolId: schoolsTable.id, name: schoolsTable.name, status: schoolsTable.status })
      .from(teacherProfilesTable)
      .innerJoin(schoolsTable, eq(teacherProfilesTable.schoolId, schoolsTable.id))
      .where(eq(teacherProfilesTable.userId, userId))
      .limit(1),
  ]);
  const reasons: string[] = [];
  if (stages.IDENTITY.status !== "VERIFIED") reasons.push("Identity verification is not complete.");
  if (stages.PROFESSIONAL.status !== "VERIFIED") reasons.push("Professional verification is not complete.");
  if (profile && profile.status !== "ACTIVE") reasons.push("Your school is still waiting to be confirmed in the school directory.");
  if (
    profile &&
    stages.PROFESSIONAL.status === "VERIFIED" &&
    stages.PROFESSIONAL.schoolId !== profile.schoolId
  ) {
    reasons.push("Your professional verification was for a different school. Please verify again for your current school.");
  }
  const eligible = verified.has(userId);
  if (!eligible && reasons.length === 0) reasons.push("Verification could not be confirmed.");
  return {
    eligible,
    reasons: eligible ? [] : reasons,
    stages,
    schoolId: profile?.schoolId ?? null,
    schoolName: profile?.name ?? null,
    schoolStatus: profile?.status ?? null,
  };
}

export function verificationRecordView(
  record: typeof verificationRecordsTable.$inferSelect,
  userName: string,
  extras: { schoolName?: string | null; documentCount?: number } = {},
) {
  return {
    id: record.id,
    userId: record.userId,
    userName,
    type: record.type,
    status: record.status,
    stage: record.stage,
    schoolName: extras.schoolName ?? null,
    documentCount: extras.documentCount ?? 0,
    feedback: record.reviewerFeedback,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    applicantNote: record.applicantNote,
    documentProvided: (extras.documentCount ?? 0) > 0 || Boolean(record.documentObjectKey),
    submittedAt: record.submittedAt.toISOString(),
    reviewedAt: record.reviewedAt ? record.reviewedAt.toISOString() : null,
  };
}
