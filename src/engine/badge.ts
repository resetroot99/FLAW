// © 2026 resetroot99 & ajakvani — FLAW (Flow Logic Audit Watch) — BSL 1.1
// FLAW — SVG Score Badge Generator (shields.io style)

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getBadgeColor(score: number): string {
  if (score >= 80) return '#4c1';
  if (score >= 60) return '#dfb317';
  if (score >= 40) return '#fe7d37';
  return '#e05d44';
}

function estimateTextWidth(text: string): number {
  // Approximate character widths for Verdana 11px (shields.io convention)
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width += 3.3;
    else if (/[mwMW]/.test(ch)) width += 9;
    else if (/[ilIj1!|.,;:]/.test(ch)) width += 4;
    else if (/[A-Z]/.test(ch)) width += 7.5;
    else if (/[0-9]/.test(ch)) width += 6.5;
    else if (ch === '-') width += 4.5;
    else width += 6.2;
  }
  return width;
}

export function generateBadge(score: number, rating: string): string {
  const labelText = 'FLAW';
  const scoreText = `${score}/100`;
  const ratingText = rating;

  const color = getBadgeColor(score);
  const labelColor = '#555';

  // Compute widths with padding
  const labelWidth = Math.round(estimateTextWidth(labelText) + 12);
  const valueWidth = Math.round(estimateTextWidth(scoreText) + 12);
  const totalWidth = labelWidth + valueWidth;

  // Rating badge (second row)
  const ratingPadding = 16;
  const ratingTextWidth = Math.round(estimateTextWidth(ratingText) + ratingPadding);
  const ratingWidth = Math.max(ratingTextWidth, totalWidth);

  const badgeHeight = 20;
  const ratingHeight = 18;
  const totalHeight = badgeHeight + ratingHeight + 2; // 2px gap

  const labelX = labelWidth / 2;
  const valueX = labelWidth + valueWidth / 2;
  const ratingX = ratingWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.max(totalWidth, ratingWidth)}" height="${totalHeight}">
  <title>FLAW Score: ${score}/100 — ${rating}</title>
  <defs>
    <linearGradient id="smooth" x2="0" y2="100%">
      <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
      <stop offset="1" stop-opacity=".1"/>
    </linearGradient>
    <clipPath id="round-top">
      <rect width="${totalWidth}" height="${badgeHeight}" rx="3" fill="#fff"/>
    </clipPath>
    <clipPath id="round-bottom">
      <rect width="${ratingWidth}" height="${ratingHeight}" rx="3" fill="#fff"/>
    </clipPath>
  </defs>

  <!-- Score badge (top row) -->
  <g clip-path="url(#round-top)">
    <rect width="${labelWidth}" height="${badgeHeight}" fill="${labelColor}"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${badgeHeight}" fill="${color}"/>
    <rect width="${totalWidth}" height="${badgeHeight}" fill="url(#smooth)"/>
  </g>

  <!-- Label text: FLAW -->
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" font-weight="bold">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${labelText}</text>
    <text x="${labelX}" y="14">${labelText}</text>
  </g>

  <!-- Score text -->
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" font-weight="bold">
    <text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${scoreText}</text>
    <text x="${valueX}" y="14">${scoreText}</text>
  </g>

  <!-- Rating badge (bottom row) -->
  <g transform="translate(0, ${badgeHeight + 2})">
    <g clip-path="url(#round-bottom)">
      <rect width="${ratingWidth}" height="${ratingHeight}" fill="${color}" opacity="0.85"/>
      <rect width="${ratingWidth}" height="${ratingHeight}" fill="url(#smooth)"/>
    </g>
    <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="10">
      <text x="${ratingX}" y="13" fill="#010101" fill-opacity=".3">${ratingText}</text>
      <text x="${ratingX}" y="12">${ratingText}</text>
    </g>
  </g>
</svg>`;
}

export function exportBadge(score: number, rating: string, outDir: string): string {
  const svg = generateBadge(score, rating);
  const outPath = resolve(outDir, 'flaw-badge.svg');
  writeFileSync(outPath, svg, 'utf-8');
  return outPath;
}
