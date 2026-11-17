# 第三方声明

本项目（Apache-2.0，见 `LICENSE`）用到下面这些第三方数据、代码和资源。数据的生成脚本在 `scripts/`，原始文件下载到 `data/raw/`（不进仓库），进仓库、进产物的是脚本处理后的结果。

| 来源 | 许可证 | 用了什么 | 用在哪 |
|---|---|---|---|
| [Danbooru](https://danbooru.donmai.us) API | 没有声明许可证 | tag 名单和作品数、别名、蕴含、tag group / list_of_* 页的分节结构；画师库的作品数和图 | `src/assets/tags/*.json.gz`（`scripts/fetch-tags.mjs` → `scripts/build-tags.mjs`）；细分类 `data/tags/tree/danbooru-map.tsv` + `scripts/lib/tree.mjs`；画师库的名单、作品数、其他名字、作品数前 2000 个的帖子 id / md5 / 宽高、共现 tag、链接 `src/assets/artists/*.json.gz`（`scripts/fetch-artists.mjs` 拉到 `data/raw/artists/`，不进仓库 → `scripts/build-artists.mjs`），只有元数据和 tag 名，图在浏览器里直接从 Danbooru 加载，不进仓库；其余画师的图、共现 tag、链接在浏览器里运行时从 Danbooru 取，缓存在用户本地（IndexedDB）；e2e 的 30 个画师数据 `e2e/fixtures/danbooru-artists.json`；蕴含关系也用在发现页的折叠（`src/assets/tags/tree.json.gz`）；发现页释义卡的 wiki 正文在浏览器里运行时从 Danbooru 取、链回原页，不进仓库（`src/lib/wiki.ts`）；发现页的 tag 中文释义参考了 Danbooru wiki 的英文正文（`scripts/fetch-wiki.mjs` 拉到 `data/raw/`，不进仓库），释义是本项目按 `data/zh/wiki-style.md` 自己写的一两句话、不是逐句翻译（`data/zh/wiki.tsv` → `src/assets/tags/wiki.json.gz`） |
| [newtextdoc1111/danbooru-tag-csv](https://huggingface.co/datasets/newtextdoc1111/danbooru-tag-csv)（2025-05） | MIT | `danbooru_tags.csv`：后来改了名的旧写法和作品数、Danbooru 上的其他名字；`danbooru_tags_cooccurrence.csv`：共现 | 认得的 tag（`scripts/lib/universe.mjs`）、搜索别名、冷门角色的中文兜底、`src/assets/tags/cooc.json.gz`（推荐）；2025 年以后的新角色的作品（`src/assets/tags/chars.json.gz`） |
| [HDiffusion/historical-danbooru-tag-counts](https://huggingface.co/datasets/HDiffusion/historical-danbooru-tag-counts)（2026-01-05） | Apache-2.0 | 当时的 tag 名单和作品数 | 认得的 tag：之后改了名的旧写法（`scripts/lib/universe.mjs`） |
| [isek-ai/danbooru-tags-2024](https://huggingface.co/datasets/isek-ai/danbooru-tags-2024) | CC0-1.0 | 860 万张图的分级、tag 和分数 | 按 tag 统计的分级占比 `data/tags/ratings.tsv`（`scripts/build-ratings.mjs`）→ NSFW 档；画师库里「一张一般 / 敏感作品都没有」的画师（`scripts/build-artist-nsfw.mjs` → `data/artists/nsfw-only.txt`）；已弃用旧词的旧作品数；角色 → 作品（每张图的角色 / 作品两列，`scripts/build-chars.mjs` → `src/assets/tags/chars.json.gz`）；画师人气（每张图的 score，`scripts/build-artist-popularity.mjs` → `src/assets/artists/popularity.json.gz`） |
| [DominikDoom/a1111-sd-webui-tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete) | MIT | `tags/danbooru.csv` 的三个历史版本（2022-11、2024-02、2025-01）里的作品数 | NAI 认、但 Danbooru 已弃用的旧词（bangs、silver hair……）的旧作品数，只用来排序（`scripts/build-tags.mjs`） |
| [Aaalice233/ComfyUI-Danbooru-Gallery](https://github.com/Aaalice233/ComfyUI-Danbooru-Gallery) | MIT | `zh_cn/` 的中文译名 | 搜索里别的中文叫法；冷门角色 / 作品没翻译时的显示名（`scripts/build-tags.mjs`）；审核译名时，个别通用 tag 的显示名采用了和它一致的社区叫法（`data/zh/general.tsv`） |
| [Physton/sd-webui-prompt-all-in-one](https://github.com/Physton/sd-webui-prompt-all-in-one) | MIT | `group_tags/zh_CN.yaml` 的中文译名 | 搜索里别的中文叫法；审核译名时，个别通用 tag 的显示名采用了和它一致的社区叫法（`data/zh/general.tsv`） |
| Qwen tokenizer（[Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B)） | Apache-2.0 | `tokenizer.json` 的 BPE merges、切词正则、added token（和 NovelAI 网页给 V5 用的那份逐条一样） | `src/assets/qwen35-merges.bin`，算 V5 的 token 长度（`scripts/build-tokenizer.mjs`） |
| T5 tokenizer（[google/t5_xxl_true_nli_mixture](https://huggingface.co/google/t5_xxl_true_nli_mixture)） | Apache-2.0 | `tokenizer.json` 的 SentencePiece 词表（piece + 分数，和 NovelAI 网页给 V4 / V4.5 用的那份逐条一样） | `src/assets/t5-vocab.bin`，算 V4 / V4.5 的 token 长度（`scripts/build-tokenizer-t5.mjs`） |
| NovelAI 补全接口 `suggest-tags` | 不是授权数据 | 只用来核对 NAI 认不认某个词，以及 NAI 给的作品数（封顶 10000） | `data/tags/nai.tsv`（NAI 特殊词）、`data/tags/nai-old.tsv`（核对过的旧词） |

中文译名和 tag 中文释义（`data/zh/`）、细分类（`data/tags/tree/`）、NSFW 手调表（`data/tags/nsfw.tsv`）由本项目整理、编写；采用社区译名的来源见上表。GPL-3.0 的 zhulinyv/Auto-NovelAI-Refactor 和 AGPL-3.0 的 wfjsw/danbooru-diffusion-prompt-builder（「Danbooru 标签超市」tags.novelai.dev 的数据）曾用于译名对照，未整体纳入产物。一次译名审核的历史提交与本地审核资料可重建出 42 个与 GPL 词表写法相同、且不同于原建议名的短译名；其中 1 个（undershirt「汗衫」）也见于 MIT 来源 Aaalice 和 Physton，另 41 个在本地核对的这两份 MIT 来源中未找到同一 tag 的相同写法，Danbooru 别名快照也未提供同写法佐证。这些词条仍保留在译名表中，来源不确定性尚未全部消除；短词相同本身不作许可适用性的结论。

## 代码和资源

| 来源 | 许可证 | 用了什么 | 用在哪 |
|---|---|---|---|
| npm 依赖（React、Radix UI、Fastify 等） | 各自的许可证（MIT、ISC、Apache-2.0、BSD 等） | 打进程序的 npm 包 | 发布包里的 `LICENSES.npm.txt`：`npm run release` 用 rollup-plugin-license 按实际打进去的包生成，每个包带许可证全文 |
| [Electron](https://www.electronjs.org/)、Chromium | MIT；Chromium 见 `LICENSES.chromium.html` | 桌面程序的运行环境 | 发布包里的 `LICENSE.electron.txt`、`LICENSES.chromium.html` |
| [Geist](https://github.com/vercel/geist-font)（`@fontsource-variable/geist`） | OFL-1.1 | 界面字体 | 打进前端（`src/index.css`） |
| [IBM Plex Sans、IBM Plex Mono](https://github.com/IBM/plex)（`@fontsource-variable/ibm-plex-sans`、`@fontsource/ibm-plex-mono`） | OFL-1.1 | 界面字体、等宽字体 | 打进前端（`src/index.css`） |
| [Hugeicons](https://hugeicons.com)（`@hugeicons/core-free-icons`、`@hugeicons/react`） | MIT | 界面图标 | 整个界面 |
| [LobeHub Icons](https://github.com/lobehub/lobe-icons)（`@lobehub/icons-static-svg` 1.70.0） | MIT | 各家 AI 服务的图标：svg 原样放进代码，只去掉宽高和 style | `src/components/ai-chat/provider-icons.ts` |

字体的版权声明：Geist — Copyright 2024 The Geist Project Authors；IBM Plex — Copyright 2017, 2019 IBM Corp.。SIL Open Font License 1.1 全文在各字体包的 `LICENSE` 里，发布包的 `LICENSES.npm.txt` 里也有。

## MIT 许可证的署名

上面两张表里 MIT 来源的版权声明：

- newtextdoc1111/danbooru-tag-csv — Copyright (c) newtextdoc1111
- DominikDoom/a1111-sd-webui-tagcomplete — Copyright (c) 2022 Dominik Reh
- Aaalice233/ComfyUI-Danbooru-Gallery — Copyright (c) 2026 Aaalice233
- Physton/sd-webui-prompt-all-in-one — Copyright (c) 2023 Physton
- Hugeicons — Copyright (c) 2025 Hugeicons
- LobeHub Icons — Copyright (c) 2023 LobeHub

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache-2.0

HDiffusion/historical-danbooru-tag-counts、Qwen tokenizer 和 T5 tokenizer 是 Apache-2.0，全文和本项目的 `LICENSE` 相同。
