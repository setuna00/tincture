# Supplemental license sources

The files are keyed by the bundled package name and exact version. Their first
line records the upstream URL; the remaining text is retained verbatim.

- `@ai-sdk/provider-utils@5.0.71`: the root LICENSE at the package's release tag.
- The three Embla packages at `8.6.0`: the shared repository LICENSE at the npm
  metadata's gitHead, `0fe65834136f1aa35e4c1a4a477e5ccb4bb5ee54`.
- `@workflow/serde@4.1.0`: the root LICENSE.md at
  `4e435e03329c0b4f8dba9608e3fc6ea4058b67fa`, identified by the npm SLSA
  provenance at https://registry.npmjs.org/-/npm/v1/attestations/@workflow%2fserde@4.1.0.
- `abstract-logging@2.0.1`: its version commit
  https://github.com/jsumners/abstract-logging/blob/80dfaef91ee87008f4ed2b6e78921d383bccd406/Readme.md
  links to the author's MIT license site. That commit has no license file, so
  the supplement retains the linked site's plain text as retrieved on 2026-11-16
  (including its current copyright year), rather than inventing a historical text.
- `react-remove-scroll-bar@2.3.8`: declares MIT in npm metadata, but its gitHead
  `b3b1287aad81def2e2ae707274b74531b61ddbaf` returns 404 upstream and the newest
  release tag (`v2.3.7`) has no license file. The supplement is the MIT LICENSE the
  same author later added to the repository, pinned at
  `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff` (retrieved on 2026-11-16, including
  its current copyright year).
