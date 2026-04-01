/**
 * bandsintown-atom.js
 *
 * Drop-in script that reads a band's Bandsintown events and generates
 * a downloadable Atom feed.  Works entirely client-side — no server needed.
 *
 * Usage (pick ONE):
 *
 * 1. Auto-detect from an existing Bandsintown widget on the page:
 *    Just include after the widget script — it will detect the artist
 *    from the widget's rendered iframe or from the .bit-widget-initializer
 *    anchor (if it still exists in the DOM).
 *
 *    <script src="https://widgetv3.bandsintown.com/main.min.js"></script>
 *    <a class="bit-widget-initializer"
 *       data-artist-name="id_15570758" ...></a>
 *    <script src="bandsintown-atom.js"></script>
 *
 * 2. Explicit configuration via data attributes:
 *
 *    <script src="bandsintown-atom.js"
 *            data-artist="id_15570758"
 *            data-app-id="mysite"></script>
 *
 * Optional data attributes on the <script> tag:
 *   data-artist    — artist name or "id_NNNNN" (overrides widget detection)
 *   data-app-id    — Bandsintown app_id (auto-detected from widget if omitted)
 *   data-no-link   — if present, don't inject the visible feed link
 *   data-link-text — custom text for the feed link (default: "Event Feed (Atom)")
 *   data-container — CSS selector for where to append the feed link
 */
(function () {
  "use strict";

  var scriptTag = document.currentScript;

  function attr(name) {
    return scriptTag && scriptTag.getAttribute("data-" + name);
  }

  // ---------------------------------------------------------------------------
  // 1. Resolve artist configuration
  // ---------------------------------------------------------------------------
  // The v3 widget replaces the .bit-widget-initializer anchor after it renders,
  // so we extract config from the widget's iframe src instead.

  var detectedAppId = null;

  function detectArtist() {
    var name = attr("artist");
    if (name) return name;

    // Widget anchor — may already be consumed by v3 widget
    var widget = document.querySelector(".bit-widget-initializer");
    if (widget) {
      name = widget.getAttribute("data-artist-name");
      if (name) return name;
    }

    // Extract artist_id and app_id from the widget's iframe src
    var container = document.querySelector(".bit-widget-container");
    if (container) {
      var iframe = container.querySelector("iframe");
      if (iframe) {
        var src = iframe.getAttribute("src") || "";
        var appMatch = src.match(/app_id=([^&]+)/);
        if (appMatch) detectedAppId = appMatch[1];
        var idMatch = src.match(/artist_id=([^&]+)/);
        if (idMatch) return "id_" + idMatch[1];
      }
    }

    // Fallback: extract from rendered widget links (non-iframe widgets)
    var links = document.querySelectorAll(
      'a[href*="bandsintown.com/artist-subscribe"], a[href*="bandsintown.com/a/"]'
    );
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";
      var subMatch = href.match(/artist-subscribe\/(\d+)/);
      if (subMatch) return "id_" + subMatch[1];
      var aMatch = href.match(/bandsintown\.com\/a\/(\d+)/);
      if (aMatch) return "id_" + aMatch[1];
    }

    return null;
  }

  function init() {
    var artistName = detectArtist();
    var appId = attr("app-id") || detectedAppId || "bandsintown-atom-feed";

    if (!artistName) {
      console.warn(
        "[bandsintown-atom] No artist found. Set data-artist on the " +
        "script tag or ensure a Bandsintown widget is on the page."
      );
      return;
    }

    fetchAndPublish(artistName, appId);
  }

  // ---------------------------------------------------------------------------
  // 2. Fetch events from Bandsintown REST API
  // ---------------------------------------------------------------------------

  function fetchAndPublish(artistName, appId) {
    var eventsUrl =
      "https://rest.bandsintown.com/artists/" +
      encodeURIComponent(artistName) +
      "/events?app_id=" +
      encodeURIComponent(appId) +
      "&date=upcoming";

    fetch(eventsUrl)
      .then(function (res) {
        if (!res.ok) throw new Error("Bandsintown API responded " + res.status);
        return res.json();
      })
      .then(function (events) {
        if (!Array.isArray(events) || events.length === 0) return;
        var displayName = events[0].artist ? events[0].artist.name : artistName;
        var atomXml = buildAtomFeed(displayName, events);
        publishFeed(displayName, atomXml);
      })
      .catch(function (err) {
        console.error("[bandsintown-atom]", err);
      });
  }

  // ---------------------------------------------------------------------------
  // 3. Build Atom XML
  // ---------------------------------------------------------------------------

  function escapeXml(s) {
    if (!s) return "";
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function toIso(dateStr) {
    if (dateStr && dateStr.indexOf("Z") === -1 && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
      dateStr += "Z";
    }
    return dateStr || "";
  }

  function buildAtomFeed(artist, events) {
    var now = new Date().toISOString();
    var feedId =
      "tag:bandsintown.com," +
      new Date().getFullYear() +
      ":" +
      encodeURIComponent(artist) +
      ":events";
    var artistUrl =
      "https://www.bandsintown.com/a/" + (events[0].artist_id || "0");

    var xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += '<feed xmlns="http://www.w3.org/2005/Atom">\n';
    xml += "  <title>" + escapeXml(artist) + " — Upcoming Shows</title>\n";
    xml += "  <id>" + escapeXml(feedId) + "</id>\n";
    xml += "  <updated>" + now + "</updated>\n";
    xml += '  <link href="' + escapeXml(artistUrl) + '" rel="alternate"/>\n';
    xml += "  <author><name>" + escapeXml(artist) + "</name></author>\n";
    xml += "  <generator>bandsintown-atom.js</generator>\n\n";

    for (var i = 0; i < events.length; i++) {
      xml += buildEntry(artist, events[i]);
    }

    xml += "</feed>\n";
    return xml;
  }

  function buildEntry(artist, ev) {
    var venue = ev.venue || {};
    var title = formatEventTitle(artist, ev);
    var dateIso = toIso(ev.datetime || ev.starts_at);
    var entryId = "tag:bandsintown.com,2025:event/" + ev.id;
    var link = ev.url || "";
    var summary = formatSummary(ev);

    var xml = "  <entry>\n";
    xml += "    <title>" + escapeXml(title) + "</title>\n";
    xml += "    <id>" + escapeXml(entryId) + "</id>\n";
    xml += "    <updated>" + dateIso + "</updated>\n";
    if (link) {
      xml += '    <link href="' + escapeXml(link) + '" rel="alternate"/>\n';
    }
    xml += '    <content type="html">' + escapeXml(summary) + "</content>\n";
    if (venue.name) {
      xml +=
        "    <summary>" +
        escapeXml(venue.name + ", " + (venue.location || venue.city || "")) +
        "</summary>\n";
    }
    xml += "  </entry>\n";
    return xml;
  }

  function formatEventTitle(artist, ev) {
    var venue = ev.venue || {};
    var date = (ev.datetime || "").split("T")[0];
    var parts = [artist];
    if (venue.name) parts.push("@ " + venue.name);
    if (venue.city) parts.push("(" + venue.city + ")");
    if (date) parts.push("— " + date);
    return parts.join(" ");
  }

  function formatSummary(ev) {
    var venue = ev.venue || {};
    var parts = [];

    if (ev.title) parts.push("<p><strong>" + ev.title + "</strong></p>");

    var when = (ev.datetime || ev.starts_at || "").replace("T", " ");
    if (when) parts.push("<p>Date: " + when + "</p>");

    if (venue.name) {
      var loc = venue.name;
      if (venue.street_address) loc += ", " + venue.street_address;
      if (venue.city) loc += ", " + venue.city;
      if (venue.region) loc += ", " + venue.region;
      if (venue.country) loc += ", " + venue.country;
      parts.push("<p>Venue: " + loc + "</p>");
    }

    if (ev.lineup && ev.lineup.length > 0) {
      parts.push("<p>Lineup: " + ev.lineup.join(", ") + "</p>");
    }

    if (ev.offers && ev.offers.length > 0) {
      for (var j = 0; j < ev.offers.length; j++) {
        var offer = ev.offers[j];
        if (offer.url) {
          parts.push(
            '<p><a href="' +
              offer.url +
              '">' +
              (offer.type || "Tickets") +
              "</a></p>"
          );
        }
      }
    }

    if (ev.description) parts.push("<p>" + ev.description + "</p>");

    return parts.join("\n");
  }

  // ---------------------------------------------------------------------------
  // 4. Publish: auto-discovery link + visible download link
  // ---------------------------------------------------------------------------

  function publishFeed(displayName, atomXml) {
    var blob = new Blob([atomXml], { type: "application/atom+xml" });
    var blobUrl = URL.createObjectURL(blob);

    // Inject <link> for feed auto-discovery
    var discoveryLink = document.createElement("link");
    discoveryLink.rel = "alternate";
    discoveryLink.type = "application/atom+xml";
    discoveryLink.title = displayName + " — Upcoming Shows";
    discoveryLink.href = blobUrl;
    document.head.appendChild(discoveryLink);

    // Optionally suppress the visible feed link
    if (scriptTag && scriptTag.hasAttribute("data-no-link")) {
      return;
    }

    var linkText = attr("link-text") || "Event Feed (Atom)";
    var a = document.createElement("a");
    a.href = blobUrl;
    a.download = slugify(displayName) + "-events.atom";
    a.textContent = linkText;
    a.style.cssText = "display:inline-block;margin:8px 0;font-size:14px;";

    var containerSel = attr("container");
    var container = containerSel
      ? document.querySelector(containerSel)
      : null;

    if (container) {
      container.appendChild(a);
    } else {
      var ref =
        document.querySelector(".bit-widget-container") ||
        document.querySelector(".bit-widget") ||
        scriptTag;
      if (ref && ref.parentNode) {
        ref.parentNode.insertBefore(a, ref.nextSibling);
      } else {
        document.body.appendChild(a);
      }
    }
  }

  function slugify(s) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // ---------------------------------------------------------------------------
  // 5. Wait for widget to render, then initialize
  // ---------------------------------------------------------------------------
  // The v3 widget loads async and replaces the .bit-widget-initializer anchor.
  // We wait for the iframe to appear inside .bit-widget-container.

  function widgetReady() {
    var container = document.querySelector(".bit-widget-container");
    return container && !!container.querySelector("iframe");
  }

  function waitForWidget() {
    if (attr("artist")) {
      init();
      return;
    }

    if (widgetReady()) {
      init();
      return;
    }

    var initiated = false;
    function initOnce() {
      if (!initiated) { initiated = true; init(); }
    }

    var observer = new MutationObserver(function (mutations, obs) {
      if (widgetReady()) {
        obs.disconnect();
        initOnce();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(function () {
      observer.disconnect();
      initOnce();
    }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForWidget);
  } else {
    waitForWidget();
  }
})();
