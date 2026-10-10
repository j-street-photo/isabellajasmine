// scripts/sync-cloudinary.js
//
// Pulls all images from specific Cloudinary folders and writes one Hugo
// data file per gallery (data/<slug>.json), sorted newest-first by
// capture date (EXIF DateTimeOriginal when available, else upload time).
//
// Requires env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

const fs = require("fs");
const path = require("path");

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.error("Missing one of CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET");
  process.exit(1);
}

// Cloudinary folder name -> Hugo content/data slug
const FOLDER_MAP = {
  "Painting": "painting",
  "Sculpture": "sculpture",
  "Architectural and Landscape": "architectural_and_landscape",
  "Other": "other",
};

const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");

async function fetchFolder(folderName) {
  const results = [];
  let nextCursor = undefined;

  do {
    const body = {
      expression: `folder="${folderName}"`,
      sort_by: [{ created_at: "desc" }],
      max_results: 500,
      with_field: ["context", "image_metadata"],
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    };

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${AUTH}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloudinary API error (${res.status}) for folder "${folderName}": ${text}`);
    }

    const data = await res.json();
    results.push(...(data.resources || []));
    nextCursor = data.next_cursor;
  } while (nextCursor);

  return results;
}

function captureDate(resource) {
  const exifDate = resource.image_metadata && resource.image_metadata.DateTimeOriginal;
  if (exifDate) {
    const iso = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
    const parsed = new Date(iso);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return resource.created_at;
}

function toGalleryEntry(resource) {
  const ctx = resource.context || {};
  const caption = ctx.caption || (ctx.custom && ctx.custom.caption) || null;
  return {
    public_id: resource.public_id,
    format: resource.format,
    width: resource.width,
    height: resource.height,
    date: captureDate(resource),
    caption: caption,
  };
}

async function main() {
  const outDir = path.join(__dirname, "..", "data");
  fs.mkdirSync(outDir, { recursive: true });

  for (const [folderName, slug] of Object.entries(FOLDER_MAP)) {
    console.log(`Fetching folder "${folderName}"...`);
    const resources = await fetchFolder(folderName);

    const entries = resources
      .map(toGalleryEntry)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(entries, null, 2));
    console.log(`  Wrote ${entries.length} image(s) to data/${slug}.json`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
