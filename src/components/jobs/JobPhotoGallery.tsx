'use client';

import { useState, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Camera,
  Upload,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImageIcon,
  Plus,
} from 'lucide-react';
import type { JobPhoto, PhotoCategory } from '@/types/database';

interface JobPhotoGalleryProps {
  jobId: string;
  photos: JobPhoto[];
  loading?: boolean;
  onPhotosChange: (photos: JobPhoto[]) => void;
}

const categoryLabels: Record<PhotoCategory, string> = {
  before: 'Before',
  after: 'After',
  documentation: 'Documentation',
};

const categoryColors: Record<PhotoCategory, 'info' | 'success' | 'default'> = {
  before: 'info',
  after: 'success',
  documentation: 'default',
};

export function JobPhotoGallery({ jobId, photos, loading = false, onPhotosChange }: JobPhotoGalleryProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<PhotoCategory>('documentation');
  const [selectedPhoto, setSelectedPhoto] = useState<JobPhoto | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Guard against undefined photos
  const photoList = photos || [];

  // Group photos by category
  const photosByCategory = {
    before: photoList.filter(p => p.category === 'before'),
    after: photoList.filter(p => p.category === 'after'),
    documentation: photoList.filter(p => p.category === 'documentation'),
  };

  const allPhotos = [...photosByCategory.before, ...photosByCategory.after, ...photosByCategory.documentation];

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    const newPhotos: JobPhoto[] = [];

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', uploadCategory);

        const response = await fetch(`/api/jobs/${jobId}/photos`, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const { photo } = await response.json();
          newPhotos.push(photo);
        } else {
          const error = await response.json();
          console.error('Upload failed:', error);
        }
      }

      if (newPhotos.length > 0) {
        onPhotosChange([...photoList, ...newPhotos]);
      }
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
      setShowUploadDialog(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!confirm('Delete this photo?')) return;

    try {
      const response = await fetch(`/api/jobs/${jobId}/photos/${photoId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        onPhotosChange(photoList.filter(p => p.id !== photoId));
        if (selectedPhoto?.id === photoId) {
          setSelectedPhoto(null);
        }
        if (lightboxIndex !== null) {
          setLightboxIndex(null);
        }
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  const handleCategoryChange = async (photoId: string, newCategory: PhotoCategory) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory }),
      });

      if (response.ok) {
        const { photo } = await response.json();
        onPhotosChange(photoList.map(p => p.id === photoId ? photo : p));
      }
    } catch (error) {
      console.error('Update error:', error);
    }
  };

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = () => setLightboxIndex(null);

  const nextPhoto = () => {
    if (lightboxIndex !== null && lightboxIndex < allPhotos.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
    }
  };

  const prevPhoto = () => {
    if (lightboxIndex !== null && lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
    }
  };

  const renderPhotoGrid = (categoryPhotos: JobPhoto[], category: PhotoCategory) => {
    if (categoryPhotos.length === 0) return null;

    const startIndex = category === 'before' ? 0 :
      category === 'after' ? photosByCategory.before.length :
      photosByCategory.before.length + photosByCategory.after.length;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant={categoryColors[category]}>{categoryLabels[category]}</Badge>
          <span className="text-sm text-gray-500">({categoryPhotos.length})</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {categoryPhotos.map((photo, idx) => (
            <div
              key={photo.id}
              className="relative group aspect-square rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:border-emerald-300 transition-colors"
              onClick={() => openLightbox(startIndex + idx)}
            >
              <img
                src={photo.thumbnail_url || photo.url}
                alt={photo.caption || `${category} photo`}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(photo.id);
                  }}
                  className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {photo.caption && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                  <p className="text-xs text-white truncate">{photo.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-gray-400" />
          Photos ({photoList.length})
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => setShowUploadDialog(true)}>
          <Plus className="h-4 w-4" />
          Add Photos
        </Button>
      </CardHeader>
      <CardContent>
        {photoList.length === 0 ? (
          <div className="text-center py-8">
            <ImageIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 mb-4">No photos yet</p>
            <Button variant="outline" onClick={() => setShowUploadDialog(true)}>
              <Upload className="h-4 w-4" />
              Upload Photos
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {renderPhotoGrid(photosByCategory.before, 'before')}
            {renderPhotoGrid(photosByCategory.after, 'after')}
            {renderPhotoGrid(photosByCategory.documentation, 'documentation')}
          </div>
        )}
      </CardContent>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Upload Photos</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <div className="flex gap-2">
                {(['before', 'after', 'documentation'] as PhotoCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setUploadCategory(cat)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      uploadCategory === cat
                        ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-600/20'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {categoryLabels[cat]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleUpload(e.target.files)}
                className="hidden"
                id="photo-upload"
              />
              <label
                htmlFor="photo-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors"
              >
                <Upload className="h-8 w-8 text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">Click to select photos</span>
                <span className="text-xs text-gray-400 mt-1">or drag and drop</span>
              </label>
            </div>
          </div>
          {uploading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600"></div>
              <span className="ml-2 text-sm text-gray-600">Uploading...</span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightboxIndex !== null && allPhotos[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 text-white hover:bg-white/10 rounded-lg"
          >
            <X className="h-6 w-6" />
          </button>

          {lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); prevPhoto(); }}
              className="absolute left-4 p-2 text-white hover:bg-white/10 rounded-lg"
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {lightboxIndex < allPhotos.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); nextPhoto(); }}
              className="absolute right-4 p-2 text-white hover:bg-white/10 rounded-lg"
            >
              <ChevronRight className="h-8 w-8" />
            </button>
          )}

          <div className="max-w-4xl max-h-[80vh] p-4" onClick={(e) => e.stopPropagation()}>
            <img
              src={allPhotos[lightboxIndex].url}
              alt={allPhotos[lightboxIndex].caption || 'Photo'}
              className="max-w-full max-h-[70vh] object-contain"
            />
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2">
                <Badge variant={categoryColors[allPhotos[lightboxIndex].category as PhotoCategory]}>
                  {categoryLabels[allPhotos[lightboxIndex].category as PhotoCategory]}
                </Badge>
                {allPhotos[lightboxIndex].caption && (
                  <span className="text-white text-sm">{allPhotos[lightboxIndex].caption}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={allPhotos[lightboxIndex].category}
                  onChange={(e) => handleCategoryChange(allPhotos[lightboxIndex].id, e.target.value as PhotoCategory)}
                  className="bg-white/10 text-white border-0 rounded px-2 py-1 text-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="before" className="text-black">Before</option>
                  <option value="after" className="text-black">After</option>
                  <option value="documentation" className="text-black">Documentation</option>
                </select>
                <button
                  onClick={() => handleDelete(allPhotos[lightboxIndex].id)}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="text-center text-gray-400 text-sm mt-2">
              {lightboxIndex + 1} / {allPhotos.length}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
