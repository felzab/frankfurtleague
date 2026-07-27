"use client";

export function FooterCopyrightString() {
  return <p className="text-fluid-xxs text-foreground-muted">{`© ${new Date().getFullYear()} Frankfurt-League. All rights reserved.`}</p>;
}
