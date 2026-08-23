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
 *
 * @param note - The appointments note field string
 * @returns Parsed SahaBilgileri object or null if not found/invalid
 */
export function extractSahaBilgileriFromNote(note: string | null): SahaBilgileri | null {
  if (!note) return null;

  // Find the marker start
  const markerStart = note.indexOf('[Saha Bilgileri:');
  if (markerStart === -1) return null;

  // Find the JSON opening brace after marker
  let jsonStart = -1;
  for (let i = markerStart + 16; i < note.length; i++) {
    if (note[i] === '{') {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) return null;

  // Find matching closing brace using bracket counter
  let openBraces = 1;
  for (let i = jsonStart + 1; i < note.length; i++) {
    const char = note[i];

    if (char === '{') {
      openBraces++;
    } else if (char === '}') {
      openBraces--;

      // Found matching closing brace
      if (openBraces === 0) {
        const jsonStr = note.substring(jsonStart, i + 1);
        try {
          return JSON.parse(jsonStr) as SahaBilgileri;
        } catch (err) {
          // JSON parse failed - log but don't crash
          console.warn('Failed to parse Saha Bilgileri JSON:', {
            jsonStr,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      }
    }
  }

  // No matching closing brace found
  return null;
}
