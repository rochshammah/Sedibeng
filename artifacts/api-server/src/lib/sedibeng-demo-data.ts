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
): DemoDashboard => ({
  demonstration: true,
  counts,
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
);
