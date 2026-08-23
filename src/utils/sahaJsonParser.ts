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
  let result = extractFromBracketMarker(note, '[Saha Bilgileri:', '{');
  if (result) return result;

  // Try [Photos: [...]] format (measurement format from MeasurementEntry)
  result = extractPhotosFromNote(note);
  if (result) return result;

  return null;
}

/**
 * Extract JSON object/array from note using bracket marker and counter
 */
function extractFromBracketMarker(note: string, marker: string, openChar: string): SahaBilgileri | null {
  const markerStart = note.indexOf(marker);
  if (markerStart === -1) return null;

  // Find the opening bracket after marker
  let jsonStart = -1;
  for (let i = markerStart + marker.length; i < note.length; i++) {
    if (note[i] === openChar) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) return null;

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

/**
 * Extract [Photos: ...] format (MeasurementEntry format)
 * Supports both [Photos: [...]] (array) and [Photos: {...}] (object with metadata)
 */
function extractPhotosFromNote(note: string): SahaBilgileri | null {
  // Try array format first [Photos: [...]]
  let result = extractFromBracketMarker(note, '[Photos:', '[');
  if (result) return result;

  // Try object format [Photos: {...}]
  result = extractFromBracketMarker(note, '[Photos:', '{');
  return result;
}
