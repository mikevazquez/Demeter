"use client";

import { useEffect } from "react";

type PwaBrandingSyncProps = {
  name: string;
  manifestHref: string;
  appleTouchIconHref: string;
};

function ensureMeta(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.name = name;
    document.head.appendChild(element);
  }

  element.content = content;
}

function ensureLink(rel: string, href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);

  if (!element) {
    element = document.createElement("link");
    element.rel = rel;
    document.head.appendChild(element);
  }

  element.href = href;
}

export default function PwaBrandingSync({
  name,
  manifestHref,
  appleTouchIconHref,
}: PwaBrandingSyncProps) {
  useEffect(() => {
    document.title = name;
    ensureMeta("application-name", name);
    ensureMeta("apple-mobile-web-app-title", name);
    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureLink("manifest", manifestHref);
    ensureLink("apple-touch-icon", appleTouchIconHref);
  }, [appleTouchIconHref, manifestHref, name]);

  return null;
}
