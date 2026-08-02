/**
 * Extended type declarations for jsPDF
 * Adds missing getImageProperties method
 */

import "jspdf";

declare module "jspdf" {
  interface jsPDF {
    /**
     * Get properties of an image from a data URL
     */
    getImageProperties(imageData: string): {
      width: number;
      height: number;
      fileType: string;
    };
  }
}
