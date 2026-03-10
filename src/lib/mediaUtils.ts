/**
 * Compress an image file client-side using canvas.
 * This ensures the base64 payload stays under Vercel's 4.5 MB limit.
 */
export async function compressImage(
    file: File,
    maxDimension = 1024,
    quality = 0.7
): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                let w = img.width;
                let h = img.height;

                // Scale down if needed
                if (w > maxDimension || h > maxDimension) {
                    if (w > h) {
                        h = Math.round((h / w) * maxDimension);
                        w = maxDimension;
                    } else {
                        w = Math.round((w / h) * maxDimension);
                        h = maxDimension;
                    }
                }

                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("Canvas not supported");

                ctx.drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL("image/jpeg", quality);
                URL.revokeObjectURL(url);

                // Extract base64 from data URL
                const base64 = dataUrl.split(",")[1];
                resolve({ base64, mimeType: "image/jpeg" });
            } catch (e) {
                reject(e);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("No se pudo cargar la imagen"));
        };

        img.src = url;
    });
}

/**
 * Read a file as base64 using ArrayBuffer (iOS compatible).
 */
export async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

/**
 * Generate an SRT subtitle file from timestamped transcription text.
 */
export function generateSRT(text: string): string {
    // Try to parse timestamps from Gemini's response
    // Expected format: "[00:00] text" or "00:00 - 00:05: text" etc.
    const lines = text.split("\n").filter((l) => l.trim());
    const srtLines: string[] = [];
    let idx = 1;

    for (const line of lines) {
        // Try pattern: [MM:SS] or [HH:MM:SS] text
        const match = line.match(
            /\[?(\d{1,2}:?\d{2}(?::\d{2})?)\]?\s*[-–:]?\s*(.*)/
        );
        if (match) {
            const timeStr = match[1];
            const content = match[2].trim();
            if (!content) continue;

            const startTime = formatSRTTime(timeStr);
            const endTime = addSeconds(timeStr, 5);

            srtLines.push(`${idx}`);
            srtLines.push(`${startTime} --> ${endTime}`);
            srtLines.push(content);
            srtLines.push("");
            idx++;
        } else if (line.trim()) {
            // No timestamp - add with sequential timing
            const start = (idx - 1) * 5;
            const end = start + 5;
            srtLines.push(`${idx}`);
            srtLines.push(
                `${secondsToSRT(start)} --> ${secondsToSRT(end)}`
            );
            srtLines.push(line.trim());
            srtLines.push("");
            idx++;
        }
    }

    return srtLines.join("\n");
}

function formatSRTTime(ts: string): string {
    const parts = ts.split(":").map(Number);
    if (parts.length === 2) {
        return `00:${pad(parts[0])}:${pad(parts[1])},000`;
    }
    return `${pad(parts[0])}:${pad(parts[1])}:${pad(parts[2])},000`;
}

function addSeconds(ts: string, secs: number): string {
    const parts = ts.split(":").map(Number);
    let totalSec =
        parts.length === 2
            ? parts[0] * 60 + parts[1]
            : parts[0] * 3600 + parts[1] * 60 + parts[2];
    totalSec += secs;
    return secondsToSRT(totalSec);
}

function secondsToSRT(totalSec: number): string {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)},000`;
}

function pad(n: number): string {
    return n.toString().padStart(2, "0");
}

/**
 * Trigger download of a text file.
 */
export function downloadFile(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
