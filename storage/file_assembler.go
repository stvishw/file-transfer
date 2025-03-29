package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"project_10/config"
)

func AssembleFile(fileID string, totalSize int64) error {
	ChunkStorageInstance.RLock()
	chunks, exists := ChunkStorageInstance.Chunks[fileID]
	ChunkStorageInstance.RUnlock()

	if !exists {
		return errors.New("file chunks not found")
	}

	finalPath := filepath.Join(config.UploadDir, fileID)
	finalFile, err := os.Create(finalPath)
	if err != nil {
		return fmt.Errorf("failed to create final file: %v", err)
	}
	defer finalFile.Close()

	for i := int64(0); i < totalSize; i += config.ChunkSize {
		ChunkStorageInstance.RLock()
		chunkData := chunks[i]
		ChunkStorageInstance.RUnlock()

		if _, err := finalFile.Write(chunkData); err != nil {
			return fmt.Errorf("failed to write chunk to final file: %v", err)
		}
	}

	delete(ChunkStorageInstance.Chunks, fileID)

	FileTrackerInstance.Lock()
	if status, exists := FileTrackerInstance.Files[fileID]; exists {
		status.Status = "complete"
		status.StorageLocation = "completed"
	}
	FileTrackerInstance.Unlock()

	return nil
}
