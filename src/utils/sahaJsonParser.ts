/**
 * Bracket-aware Saha Bilgileri JSON extractor
 * Safely extracts nested JSON structures from note field markers
 * Replaces regex-based parsing which failed on nested braces
 *
 * Format: [Saha Bilgileri: {...nested JSON...}]
 */

export interface SahaBilgileri {
  photos?: Array<{ id: string; url: string }>;
  color?: string;
  model?: string;
  fieldNotes?: string;
}

/**
 * Extract Saha Bilgileri JSON from note field using bracket counting
 * Handles nested structures (arrays, objects within objects)
 * Supports both [Saha Bilgileri: {...}] and [Photos: [...]] formats
 *
 * @param note - The appointments note field string
 * @returns Parsed SahaBilgileri object or null if not found/invalid
 */
export function extractSahaBilgileriFromNote(note: string | null): SahaBilgileri | null {
  if (!note) return null;

  // Try [Saha Bilgileri: {...}] format first (new format)
  let result = extractFromBracketMarker(note, '[Saha Bilgileri:');
  if (result) return result;

  // Try [Photos: ...] format (measurement format from MeasurementEntry) —
  // supports both [Photos: [...]] (legacy array) and [Photos: {...}] (current
  // object with photos/color/model/fieldNotes) via the SAME call below.
  result = extractFromBracketMarker(note, '[Photos:');
  if (result) return result;

  return null;
}

/**
 * Extract JSON object/array from note using bracket marker and counter.
 *
 * The open bracket is the first non-whitespace character immediately after
 * the marker — NOT the first occurrence of a hardcoded bracket type scanned
 * forward. Scanning forward for a fixed bracket (e.g. always "[") could
 * previously lock onto a NESTED array inside an outer object (e.g. the
 * "photos" array inside `[Photos: {"photos":[...], "fieldNotes":...}]`,
 * since "photos" is always serialized first), silently truncating the match
 * to that inner array and dropping every sibling key (color/model/fieldNotes).
 */
function extractFromBracketMarker(note: string, marker: string): SahaBilgileri | null {
  const markerStart = note.indexOf(marker);
  if (markerStart === -1) return null;

  // Find the first non-whitespace character after the marker; it must be the
  // actual JSON's own opening bracket, whichever type it genuinely is.
  let jsonStart = -1;
  for (let i = markerStart + marker.length; i < note.length; i++) {
    if (!/\s/.test(note[i])) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) return null;

  const openChar = note[jsonStart];
  if (openChar !== '{' && openChar !== '[') return null;

  // Find matching closing bracket using counter
  const closeChar = openChar === '{' ? '}' : ']';
  let openCount = 1;
  for (let i = jsonStart + 1; i < note.length; i++) {
    const char = note[i];

    if (char === openChar) {
      openCount++;
    } else if (char === closeChar) {
      openCount--;

      if (openCount === 0) {
        const jsonStr = note.substring(jsonStart, i + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          // Convert array format to object if needed
          if (Array.isArray(parsed)) {
            return { photos: parsed };
          }
          return parsed as SahaBilgileri;
        } catch (err) {
          console.warn('Failed to parse Saha Bilgileri JSON:', {
            jsonStr,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      }
    }
  }

  return null;
}
