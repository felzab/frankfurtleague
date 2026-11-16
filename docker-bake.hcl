# The two images, built side by side in one bake by the images job of `.github/workflows/verify.yml`,
# whose environment sets every variable below; docker/metadata-action's bake file adds the labels.

variable "FRONTEND_IMAGE" {}
variable "BACKEND_IMAGE" {}
variable "VERIFY_TAG" {}

# `sha-<commit>`: each image's published tag and the version it is stamped with.
variable "APP_VERSION" {}

# Where each image's tarball is written, the bytes the job checks and the publish pushes.
variable "TARBALL_DIR" {}

variable "READ_CACHE" {
  default = false
}
variable "WRITE_CACHE" {
  default = false
}

group "default" {
  targets = ["frontend", "backend"]
}

target "docker-metadata-action" {}

# One cache scope per image, buildx overwriting rather than merging a key, and `version` left to
# buildx, which picks the live cache service.
target "frontend" {
  inherits   = ["docker-metadata-action"]
  context    = "fl_frontend"
  tags       = ["${VERIFY_TAG}:frontend", "${FRONTEND_IMAGE}:${APP_VERSION}"]
  args       = { APP_VERSION = APP_VERSION }
  output     = ["type=docker,dest=${TARBALL_DIR}/frontend.tar"]
  cache-from = READ_CACHE ? ["type=gha,scope=frontend"] : []
  cache-to   = WRITE_CACHE ? ["type=gha,scope=frontend,mode=max"] : []
}

target "backend" {
  inherits   = ["docker-metadata-action"]
  context    = "fl_backend"
  tags       = ["${VERIFY_TAG}:backend", "${BACKEND_IMAGE}:${APP_VERSION}"]
  args       = { APP_VERSION = APP_VERSION }
  output     = ["type=docker,dest=${TARBALL_DIR}/backend.tar"]
  cache-from = READ_CACHE ? ["type=gha,scope=backend"] : []
  cache-to   = WRITE_CACHE ? ["type=gha,scope=backend,mode=max"] : []
}
