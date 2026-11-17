# The linters and the shell parser the gate runs from images, each pinned here alone and never
# built. Dependabot's `docker` ecosystem moves a `FROM` line, where no ecosystem reads an image typed
# in a shell string, so each caller reads its image from the line its stage name marks and hands it
# to `docker run`. shfmt's alpine variant carries the shell its sweep loops over the scripts in.
FROM koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d AS shellcheck
FROM rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 AS actionlint
FROM lycheeverse/lychee:0.24.2@sha256:e2d19e57cf6ab037026f20b8e449a1f30d9d7f81eef4194763aab2eab20bd28d AS lychee
FROM mvdan/shfmt:v3.14.1-alpine@sha256:c7a0dfa73dfea80e9d9e185c655b44759eea2df85dec142295bcc0bb600c6266 AS shfmt
