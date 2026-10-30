import type { AssistanceRequest, DemoDashboard } from "@workspace/api-zod";

const demoImage = (name: string) => `/images/${name}`;

export const assistanceRequests: AssistanceRequest[] = [
  {
    id: "shoes-gaborone-west",
    title: "Durable school shoes",
    category: "School shoes",
    item: "Black school shoes",
    description:
      "A sample request for sturdy, everyday school shoes in a range of sizes.",
    specifications: "Closed-toe, durable sole; sizes 1–4",
    quantity: 8,
    unit: "pairs",
    location: "Gaborone West",
    schoolContext: "Primary school • Gaborone",
    priority: "Essential",
    status: "Open",
    imageUrl: demoImage("sedibeng-school-shoes.jpg"),
    imageAlt: "Black school shoes arranged on a warm wooden bench",
    updatedLabel: "Updated recently",
    demonstration: true,
  },
  {
    id: "books-block-8",
    title: "Exercise books for a new term",
    category: "Books & stationery",
    item: "A4 exercise books",
    description:
      "A sample request for lined exercise books to support everyday classroom learning.",
    specifications: "A4, ruled, 96 pages",
    quantity: 24,
    unit: "books",
    location: "Block 8",
    schoolContext: "Primary school • Gaborone",
    priority: "High",
    status: "Open",
    imageUrl: demoImage("sedibeng-stationery-kit.jpg"),
    imageAlt: "School exercise books and stationery arranged on a desk",
    updatedLabel: "Updated recently",
    demonstration: true,
  },
  {
    id: "backpacks-main-mall",
    title: "Everyday school backpacks",
    category: "Bags",
    item: "School backpacks",
    description:
      "A sample request for reliable backpacks with room for books and lunch.",
    specifications: "Durable fabric, reinforced straps, child-size",
    quantity: 6,
    unit: "bags",
    location: "Main Mall area",
    schoolContext: "Primary school • Gaborone",
    priority: "Standard",
    status: "Partially matched",
    imageUrl: demoImage("sedibeng-backpack-books.jpg"),
    imageAlt: "A navy backpack beside exercise books and pencils",
    updatedLabel: "Updated this week",
    demonstration: true,
  },
  {
    id: "uniforms-phase-2",
    title: "School uniform essentials",
    category: "Uniforms",
    item: "White shirts and navy shorts",
    description:
      "A sample request for practical uniform essentials for the school week.",
    specifications: "Washable fabric; assorted sizes",
    quantity: 10,
    unit: "sets",
    location: "Phase 2",
    schoolContext: "Primary school • Gaborone",
    priority: "High",
    status: "Open",
    imageUrl: demoImage("sedibeng-community-preparation.jpg"),
    imageAlt: "School essentials being carefully prepared on a classroom table",
    updatedLabel: "Updated this week",
    demonstration: true,
  },
  {
    id: "classroom-kit-tlokweng-road",
    title: "Classroom stationery kit",
    category: "Books & stationery",
    item: "Pencils, rulers and crayons",
    description:
      "A sample request for everyday classroom stationery used throughout the term.",
    specifications: "HB pencils, 30 cm rulers, washable crayons",
    quantity: 12,
    unit: "kits",
    location: "Tlokweng Road",
    schoolContext: "Primary school • Gaborone",
    priority: "Standard",
    status: "Matched",
    imageUrl: demoImage("sedibeng-stationery-kit.jpg"),
    imageAlt: "A classroom stationery kit with pencils, rulers and books",
    updatedLabel: "Updated this week",
    demonstration: true,
  },
  {
    id: "shoes-broadhurst",
    title: "Closed school shoes",
    category: "School shoes",
    item: "Black lace-up shoes",
    description:
      "A sample request for closed school shoes suited to daily wear.",
    specifications: "Black, lace-up, sturdy sole; assorted sizes",
    quantity: 5,
    unit: "pairs",
    location: "Broadhurst",
    schoolContext: "Primary school • Gaborone",
    priority: "Essential",
    status: "Open",
    imageUrl: demoImage("sedibeng-school-shoes.jpg"),
    imageAlt: "Pairs of black school shoes ready for a school essentials drive",
    updatedLabel: "Updated this week",
    demonstration: true,
  },
];

const makeDashboard = (
  counts: DemoDashboard["counts"],
  records: DemoDashboard["records"],
  modules: DemoDashboard["modules"],
): DemoDashboard => ({
  demonstration: true,
  counts,
  records,
  modules,
});

const sampleRecord = (
  id: string,
  title: string,
  detail: string,
  status: string,
  imageUrl: string,
): DemoDashboard["records"][number] => ({
  id,
  title,
  detail,
  status,
  imageUrl,
});

const sampleModule = (
  id: string,
  title: string,
  detail: string,
  status: string,
  records: DemoDashboard["records"],
): DemoDashboard["modules"][number] => ({
  id,
  title,
  detail,
  status,
  records,
});

export const donorDashboard = makeDashboard(
  [
    { label: "Available items", value: 3, detail: "Sample inventory" },
    { label: "Open offers", value: 2, detail: "Preview only" },
    { label: "Suggested matches", value: 4, detail: "Not allocated" },
    { label: "Completed", value: 1, detail: "Sample activity" },
  ],
  [
    {
      id: "donor-inventory-shoes",
      title: "Black school shoes",
      detail: "Sample inventory · Gaborone",
      status: "Available",
      imageUrl: demoImage("sedibeng-school-shoes.jpg"),
    },
    {
      id: "donor-match-books",
      title: "Exercise books",
      detail: "Sample match suggestion · Block 8",
      status: "Suggested",
      imageUrl: demoImage("sedibeng-stationery-kit.jpg"),
    },
    {
      id: "donor-fulfilment-backpack",
      title: "School backpack",
      detail: "Sample fulfilment preview",
      status: "In progress",
      imageUrl: demoImage("sedibeng-backpack-books.jpg"),
    },
  ],
  [
    sampleModule("inventory", "Available inventory", "Example goods only; no inventory is saved.", "Preview", [
      sampleRecord("inventory-shoes", "Black school shoes", "Pairs available in the Gaborone demonstration.", "Available", demoImage("sedibeng-school-shoes.jpg")),
      sampleRecord("inventory-books", "Exercise books", "A sample stationery listing.", "Available", demoImage("sedibeng-stationery-kit.jpg")),
      sampleRecord("inventory-backpack", "School backpack", "A sample bag listing.", "Available", demoImage("sedibeng-backpack-books.jpg")),
    ]),
    sampleModule("offers", "My offers", "Sample offers are not sent to a teacher or recorded.", "Preview", [
      sampleRecord("offer-shoes", "Offer: school shoes", "A goods-only example offer for Gaborone West.", "Not sent", demoImage("sedibeng-school-shoes.jpg")),
      sampleRecord("offer-books", "Offer: exercise books", "A sample offer shown for interface preview.", "Not sent", demoImage("sedibeng-stationery-kit.jpg")),
    ]),
    sampleModule("matches", "Suggested matches", "A teacher must review any proposed match before allocation.", "Teacher review", [
      sampleRecord("match-books", "Exercise books · Block 8", "Sample suggestion; no match has been made.", "Awaiting review", demoImage("sedibeng-stationery-kit.jpg")),
      sampleRecord("match-backpack", "Backpack · Main Mall area", "Sample suggestion; no allocation has been made.", "Awaiting review", demoImage("sedibeng-backpack-books.jpg")),
    ]),
    sampleModule("fulfilments", "Active fulfilments", "Tracking states are examples and are not connected to a delivery.", "Preview", [
      sampleRecord("fulfilment-bag", "School backpack", "Sample fulfilment status only.", "In progress", demoImage("sedibeng-backpack-books.jpg")),
    ]),
    sampleModule("completed", "Completed donations", "Example history only; no physical handover is confirmed.", "Preview", [
      sampleRecord("completed-shoes", "School shoes", "A demonstration-only completed state.", "Example complete", demoImage("sedibeng-school-shoes.jpg")),
    ]),
    sampleModule("notifications", "Notifications", "These sample notices are not sent to an account.", "Preview", [
      sampleRecord("notice-match", "A possible match is ready to review", "Concept notification · no match has been created.", "Example", demoImage("sedibeng-stationery-kit.jpg")),
      sampleRecord("notice-safety", "Teacher approval comes first", "A reminder of the intended safeguarding flow.", "Example", demoImage("sedibeng-community-preparation.jpg")),
    ]),
    sampleModule("account", "Account and verification", "No profile is signed in and no verification has taken place.", "Not active", [
      sampleRecord("account-demo", "Donor profile", "Account settings are a future workflow.", "Preview only", demoImage("sedibeng-community-preparation.jpg")),
    ]),
  ],
);

export const teacherDashboard = makeDashboard(
  [
    { label: "My requests", value: 3, detail: "Sample requests" },
    { label: "Suggested matches", value: 2, detail: "Awaiting teacher review" },
    { label: "Active fulfilments", value: 1, detail: "Preview only" },
    { label: "Completed", value: 1, detail: "Sample activity" },
  ],
  [
    {
      id: "teacher-request-shoes",
      title: "Durable school shoes",
      detail: "Sample request · Gaborone West",
      status: "Open",
      imageUrl: demoImage("sedibeng-school-shoes.jpg"),
    },
    {
      id: "teacher-match-books",
      title: "Exercise books",
      detail: "Sample suggestion · Teacher approval required",
      status: "Review preview",
      imageUrl: demoImage("sedibeng-stationery-kit.jpg"),
    },
    {
      id: "teacher-fulfilment-bag",
      title: "School backpack",
      detail: "Sample fulfilment preview",
      status: "In progress",
      imageUrl: demoImage("sedibeng-backpack-books.jpg"),
    },
  ],
  [
    sampleModule("requests", "My assistance requests", "School-level examples only; no request has been published.", "Preview", [
      sampleRecord("request-shoes", "Durable school shoes", "Gaborone West · demonstration request.", "Open example", demoImage("sedibeng-school-shoes.jpg")),
      sampleRecord("request-books", "Exercise books", "Block 8 · demonstration request.", "Open example", demoImage("sedibeng-stationery-kit.jpg")),
      sampleRecord("request-bags", "Everyday school backpacks", "Main Mall area · demonstration request.", "Partially matched example", demoImage("sedibeng-backpack-books.jpg")),
    ]),
    sampleModule("create-request", "Create a request", "The form is not connected; nothing can be submitted or saved.", "Not active", [
      sampleRecord("create-request-preview", "Request creation preview", "Teacher verification and moderation would happen before public listing.", "Preview only", demoImage("sedibeng-community-preparation.jpg")),
    ]),
    sampleModule("statuses", "Request statuses", "All listed states belong to demonstration content.", "Preview", [
      sampleRecord("status-open", "School shoes", "Example request status.", "Open example", demoImage("sedibeng-school-shoes.jpg")),
      sampleRecord("status-matched", "Classroom stationery kit", "Example request status; no allocation is implied.", "Matched example", demoImage("sedibeng-stationery-kit.jpg")),
    ]),
    sampleModule("matches", "Suggested donor matches", "Suggestions are examples and do not represent available goods.", "Preview", [
      sampleRecord("suggestion-books", "Exercise books", "A possible match for a school-level request.", "Awaiting teacher review", demoImage("sedibeng-stationery-kit.jpg")),
      sampleRecord("suggestion-bag", "School backpack", "A possible match for a school-level request.", "Awaiting teacher review", demoImage("sedibeng-backpack-books.jpg")),
    ]),
    sampleModule("approvals", "Match approvals", "Teacher approval is required in the intended product flow.", "No real action", [
      sampleRecord("approval-books", "Exercise books", "Review preview; no goods have been allocated.", "Needs review", demoImage("sedibeng-stationery-kit.jpg")),
    ]),
    sampleModule("fulfilments", "Fulfilment tracking", "Statuses do not confirm delivery or handover.", "Preview", [
      sampleRecord("tracking-bag", "School backpack", "Sample tracking state only.", "In progress example", demoImage("sedibeng-backpack-books.jpg")),
    ]),
    sampleModule("notifications", "Notifications", "Sample notices are not connected to a teacher account.", "Preview", [
      sampleRecord("teacher-notice-match", "A suggested match needs review", "Concept notice · no match has been created.", "Example", demoImage("sedibeng-stationery-kit.jpg")),
    ]),
    sampleModule("account", "Verification and account settings", "Teacher identity checks are not active in this demonstration.", "Not active", [
      sampleRecord("teacher-profile-demo", "Teacher profile", "Verification is a future workflow; no badge or approval is claimed.", "Unverified preview", demoImage("sedibeng-community-preparation.jpg")),
    ]),
  ],
);

export const adminDashboard = makeDashboard(
  [
    { label: "Teacher profiles", value: 4, detail: "Sample records only" },
    { label: "Requests", value: 6, detail: "Sample moderation queue" },
    { label: "Inventory entries", value: 3, detail: "Sample listings" },
    { label: "Matches to review", value: 2, detail: "Sample records only" },
  ],
  [
    {
      id: "admin-review-profile",
      title: "Teacher profile review",
      detail: "Sample workflow · no verification performed",
      status: "Preview",
      imageUrl: demoImage("sedibeng-community-preparation.jpg"),
    },
    {
      id: "admin-moderation-request",
      title: "Assistance request moderation",
      detail: "Sample workflow · no request published",
      status: "Preview",
      imageUrl: demoImage("sedibeng-school-shoes.jpg"),
    },
    {
      id: "admin-match-oversight",
      title: "Suggested match oversight",
      detail: "Sample workflow · no allocation made",
      status: "Preview",
      imageUrl: demoImage("sedibeng-backpack-books.jpg"),
    },
  ],
  [
    sampleModule("teacher-verification", "Teacher verification", "Sample review queue only; no identity checks have run.", "Not active", [
      sampleRecord("review-teacher", "Teacher profile review", "No verification document is shown or processed.", "Sample queue", demoImage("sedibeng-community-preparation.jpg")),
    ]),
    sampleModule("donor-verification", "Donor verification", "No donor account or verification decision exists.", "Not active", [
      sampleRecord("review-donor", "Donor profile review", "Example moderation workflow only.", "Sample queue", demoImage("sedibeng-community-preparation.jpg")),
    ]),
    sampleModule("request-moderation", "Assistance request moderation", "Requests would be reviewed before publication in a future phase.", "Not active", [
      sampleRecord("review-request", "School shoes · Gaborone West", "Sample request; it is not submitted to moderation.", "Example queue", demoImage("sedibeng-school-shoes.jpg")),
      sampleRecord("review-stationery", "Exercise books · Block 8", "Sample request; no publication decision has been made.", "Example queue", demoImage("sedibeng-stationery-kit.jpg")),
    ]),
    sampleModule("inventory-moderation", "Inventory moderation", "Goods listings are examples, not a live moderation queue.", "Not active", [
      sampleRecord("review-inventory", "School backpack listing", "No inventory entry has been submitted.", "Example queue", demoImage("sedibeng-backpack-books.jpg")),
    ]),
    sampleModule("match-oversight", "Match oversight", "No matching engine or allocation is active.", "Concept only", [
      sampleRecord("oversight-match", "Exercise books · Block 8", "Possible match shown for review only.", "No allocation", demoImage("sedibeng-stationery-kit.jpg")),
    ]),
    sampleModule("fulfilment-oversight", "Fulfilment oversight", "No goods handover or delivery is tracked.", "Not active", [
      sampleRecord("oversight-fulfilment", "School essentials handover", "Example oversight item; no fulfilment is confirmed.", "Preview only", demoImage("sedibeng-community-preparation.jpg")),
    ]),
    sampleModule("reports-audit", "Reports and audit activity", "No real activity or personal data is included.", "Preview", [
      sampleRecord("audit-demo", "Demonstration activity log", "An example record to preview future audit reporting.", "Example only", demoImage("sedibeng-community-preparation.jpg")),
    ]),
  ],
);
