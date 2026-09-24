import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { blankComments } from "./blankComments.ts";
import { withoutPythonComments } from "./pythonComments.ts";

const PACKAGE = path.resolve(import.meta.dirname, "../..");

// The backend's db tier names its image here.
const CONFTEST = path.resolve(PACKAGE, "..", "fl_backend", "tests", "conftest.py");

const BACKEND_IMAGE = /Container\("(mongo:[^"]+)"/g;
const FRONTEND_IMAGE = /MongoDBContainer\("(mongo:[^"]+)"\)/g;

const imagesIn = (source: string, pattern: RegExp): string[] => [...source.matchAll(pattern)].map(([, image]) => image ?? "");

/** Comments cut first: a commented-out tag above the live one would otherwise be a second image. */
const backendImagesIn = (source: string): string[] => imagesIn(withoutPythonComments(source), BACKEND_IMAGE);

/** The frontend's db-tier files, found by the suffix `test:db` collects rather than by the image they name. */
function dbTierFiles(): string[] {
  return globSync("**/*.db.test.{cjs,mjs,js,cts,mts,ts}", { cwd: PACKAGE, exclude: (name) => name === "node_modules" || name === ".next" })
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
}

describe("the mongod image both db tiers start (`docs/frontend/spec.md` §1.9)", () => {
  // Held against a sample: `conftest.py` names its one image in both spellings, so a reader of
  // either spelling alone passes the tree.
  it("reads the backend's image off both of its spellings", () => {
    assert.deepEqual(backendImagesIn('with MongoDbContainer("mongo:8").with_tmpfs_mount(x) as c:'), ["mongo:8"]);
    assert.deepEqual(backendImagesIn('DockerContainer("mongo:7.0")'), ["mongo:7.0"]);
  });

  it("reads no image off a commented-out line or a trailing comment", () => {
    const source = '    # with MongoDbContainer("mongo:7") as c:\nwith MongoDbContainer("mongo:8") as c:  # not DockerContainer("mongo:6")';
    assert.deepEqual(backendImagesIn(source), ["mongo:8"]);
  });

  // Two live calls on one line are two images, which the one-image check below has to see.
  it("reads every call on a line", () => {
    assert.deepEqual(backendImagesIn('a, b = MongoDbContainer("mongo:8"), DockerContainer("mongo:7")'), ["mongo:8", "mongo:7"]);
  });

  // A `#` inside a string cuts the line short, and a call after it would be read as a comment.
  it("refuses a hash inside a string rather than skipping the call after it", () => {
    assert.throws(
      () => backendImagesIn('DockerContainer("mongo:8").with_command("--bind_ip_all #x"); DockerContainer("mongo:7")'),
      /inside a string literal/,
    );
  });

  // One image across both tiers: a bump on one side alone tests the two against different servers.
  it("is the backend's one image in every frontend db-tier file", () => {
    const backend = new Set(backendImagesIn(readFileSync(CONFTEST, "utf8")));
    assert.equal(backend.size, 1, `the backend's db tier names ${backend.size} images: ${[...backend].join(", ")}`);

    const files = dbTierFiles();
    assert.ok(files.length > 0, "no frontend db-tier file was found");

    for (const file of files) {
      const images = imagesIn(blankComments(readFileSync(path.join(PACKAGE, file), "utf8")), FRONTEND_IMAGE);
      assert.ok(images.length > 0, `${file} starts no image this reader recognises`);
      for (const image of images) assert.ok(backend.has(image), `${file} starts ${image}, the backend ${[...backend].join(", ")}`);
    }
  });
});
