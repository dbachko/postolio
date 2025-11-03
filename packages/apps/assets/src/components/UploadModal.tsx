interface UploadModalProps {
  onClose: () => void;
  brandId: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function UploadModal({ onClose, brandId }: UploadModalProps) {
  return (
    <div className="pl-assets fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background mx-4 w-full max-w-2xl rounded-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Upload Assets</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="border-muted rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-muted-foreground">Drag and drop files here, or click to select</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Supports: Images (JPG, PNG) and Videos (MP4)
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="border-input hover:bg-accent rounded-md border px-4 py-2"
          >
            Cancel
          </button>
          <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2">
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
