package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"project_10/auth"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

var fileLocks sync.Map

type FileMetadata struct {
	FileID           string `json:"file_id"`
	Status           string `json:"status"`
	ReceivedBytes    int64  `json:"received_bytes"`
	TotalBytes       int64  `json:"total_bytes"`
	NextExpectedByte int64  `json:"next_expected_byte"`
	Checksum         int64  `json:"checksum"`
	LastUpdated      string `json:"last_updated"`
}

func InitUpload(c *gin.Context) {
	fileID := c.Query("file_id")
	totalSizeStr := c.Query("total_size")

	if fileID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file_id is required"})
		return
	}

	if totalSizeStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "total_size is required"})
		return
	}

	totalSize, err := strconv.ParseInt(totalSizeStr, 10, 64)
	if err != nil || totalSize <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "total_size must be a positive integer"})
		return
	}

	uploadDir := "./uploads/"
	if err := os.MkdirAll(uploadDir, os.ModePerm); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create upload directory"})
		return
	}

	metaPath := filepath.Join(uploadDir, fileID+".meta")

	meta := FileMetadata{
		FileID:           fileID,
		Status:           "pending",
		ReceivedBytes:    0,
		TotalBytes:       totalSize,
		NextExpectedByte: 0,
		Checksum:         0,
		LastUpdated:      time.Now().Format(time.RFC3339),
	}

	metaJSON, err := json.Marshal(meta)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to marshal metadata"})
		return
	}

	if err := os.WriteFile(metaPath, metaJSON, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write metadata file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Upload initialized successfully",
		"file_id":  fileID,
		"metadata": meta,
	})
}

func UploadChunk(c *gin.Context) {
	fileID := c.Query("file_id")
	if fileID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file_id is required"})
		return
	}

	contentRange := c.GetHeader("Content-Range")
	if contentRange == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Content-Range header is required"})
		return
	}

	rangeParts := strings.Split(strings.TrimPrefix(contentRange, "bytes "), "-")
	if len(rangeParts) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Content-Range format"})
		return
	}

	start, err := strconv.ParseInt(rangeParts[0], 10, 64)
	if err != nil || start < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start byte"})
		return
	}

	endTotalParts := strings.Split(rangeParts[1], "/")
	if len(endTotalParts) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Content-Range format"})
		return
	}

	end, err := strconv.ParseInt(endTotalParts[0], 10, 64)
	if err != nil || end <= start {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end byte"})
		return
	}

	totalSize, err := strconv.ParseInt(endTotalParts[1], 10, 64)
	if err != nil || totalSize <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid total size"})
		return
	}

	uploadDir := "./uploads/"
	metaPath := filepath.Join(uploadDir, fileID+".meta")
	filePath := filepath.Join(uploadDir, fileID)

	lock, _ := fileLocks.LoadOrStore(fileID, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()

	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "upload not initialized",
			"message": "please call /init_upload first",
		})
		return
	}

	metaJSON, err := os.ReadFile(metaPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read metadata"})
		return
	}

	var meta FileMetadata
	if err := json.Unmarshal(metaJSON, &meta); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse metadata"})
		return
	}

	if meta.TotalBytes != totalSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    "total size mismatch",
			"expected": meta.TotalBytes,
			"received": totalSize,
		})
		return
	}

	if meta.ReceivedBytes >= end {
		c.JSON(http.StatusOK, gin.H{
			"message":            "chunk already processed",
			"next_expected_byte": meta.ReceivedBytes,
		})
		return
	}

	file, err := c.FormFile("chunk")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open chunk"})
		return
	}
	defer src.Close()

	dst, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open destination file"})
		return
	}
	defer dst.Close()

	if _, err := dst.Seek(start, 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to seek in file"})
		return
	}

	if _, err := io.Copy(dst, src); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write chunk"})
		return
	}

	meta.ReceivedBytes = end
	meta.NextExpectedByte = end
	meta.Status = "partial"
	meta.LastUpdated = time.Now().Format(time.RFC3339)

	newMetaJSON, err := json.Marshal(meta)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to marshal metadata"})
		return
	}

	if err := os.WriteFile(metaPath, newMetaJSON, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save metadata"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":            "chunk uploaded successfully",
		"next_expected_byte": meta.NextExpectedByte,
		"received_bytes":     meta.ReceivedBytes,
		"total_bytes":        meta.TotalBytes,
	})
}

func Login(c *gin.Context) {
	username := c.PostForm("username")
	password := c.PostForm("password")

	if username != "admin" || password != "admin" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	token, err := auth.GenerateToken(username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	fmt.Println("Generated Token:", token)

	c.JSON(http.StatusOK, gin.H{
		"access_token": token,
		"token_type":   "bearer",
	})
}

// func InitUpload(c *gin.Context) {
// 	fileID := c.Query("file_id")
// 	totalSize, _ := strconv.ParseInt(c.Query("total_size"), 10, 64)

// 	uploadDir := "./uploads/"
// 	os.MkdirAll(uploadDir, os.ModePerm)
// 	metaPath := filepath.Join(uploadDir, fileID+".meta")

// 	meta := FileMetadata{
// 		FileID:           fileID,
// 		ReceivedBytes:    0,
// 		TotalBytes:       totalSize,
// 		NextExpectedByte: 0,
// 		Checksum:         0,
// 		LastUpdated:      time.Now().Format(time.RFC3339),
// 	}

// 	metaJSON, _ := json.Marshal(meta)
// 	os.WriteFile(metaPath, metaJSON, 0644)

// 	c.JSON(http.StatusOK, gin.H{"message": "Upload initialized", "file_id": fileID})
// }

// func UploadChunk(c *gin.Context) {
// 	fileID := c.Query("file_id")

// 	uploadDir := "./uploads/"
// 	os.MkdirAll(uploadDir, os.ModePerm)

// 	metaPath := filepath.Join(uploadDir, fileID+".meta")
// 	filePath := filepath.Join(uploadDir, fileID)

// 	lock, _ := fileLocks.LoadOrStore(fileID, &sync.Mutex{})
// 	lock.(*sync.Mutex).Lock()
// 	defer lock.(*sync.Mutex).Unlock()

// 	file, _, err := c.Request.FormFile("chunk")
// 	if err != nil {
// 		c.JSON(400, gin.H{"error": "Failed to get file chunk"})
// 		return
// 	}
// 	defer file.Close()

//
// 	out, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
// 	if err != nil {
// 		c.JSON(500, gin.H{"error": "Failed to save file"})
// 		return
// 	}
// 	defer out.Close()

// 	// Write chunk
// 	chunkSize, err := io.Copy(out, file)
// 	if err != nil {
// 		c.JSON(500, gin.H{"error": "Failed to write file"})
// 		return
// 	}

// 	metaJSON, _ := os.ReadFile(metaPath)
// 	var meta FileMetadata
// 	json.Unmarshal(metaJSON, &meta)
// 	meta.ReceivedBytes += chunkSize
// 	meta.NextExpectedByte = meta.ReceivedBytes
// 	meta.LastUpdated = time.Now().Format(time.RFC3339)
// 	newMetaJSON, _ := json.Marshal(meta)
// 	os.WriteFile(metaPath, newMetaJSON, 0644)

// 	c.JSON(http.StatusOK, gin.H{"message": "Chunk uploaded successfully", "next_expected_byte": meta.NextExpectedByte})
// }

func StatusCheck(c *gin.Context) {
	fileID := c.Param("file_id")
	metaPath := filepath.Join("./uploads/", fileID+".meta")
	metaJSON, err := os.ReadFile(metaPath)
	if err != nil {
		c.JSON(404, gin.H{"error": "File not found or not started"})
		return
	}

	var meta FileMetadata
	json.Unmarshal(metaJSON, &meta)
	c.JSON(http.StatusOK, gin.H{
		"file_id":            meta.FileID,
		"status":             "partial",
		"received_bytes":     meta.ReceivedBytes,
		"total_bytes":        meta.TotalBytes,
		"next_expected_byte": meta.NextExpectedByte,
		"checksum":           meta.Checksum,
		"last_updated":       meta.LastUpdated,
	})
}

func DownloadFile(c *gin.Context) {
	fileID := c.Param("file_id")
	filePath := filepath.Join("./uploads/", fileID)

	file, err := os.Open(filePath)
	if err != nil {
		c.JSON(404, gin.H{"error": "File not found"})
		return
	}
	defer file.Close()

	fileInfo, _ := file.Stat()
	fileSize := fileInfo.Size()

	rangeHeader := c.GetHeader("Range")
	if rangeHeader == "" {
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileID))
		c.Header("Content-Type", "application/octet-stream")
		c.File(filePath)
		return
	}
	var start, end int64
	fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end)
	if end == 0 || end > fileSize-1 {
		end = fileSize - 1
	}

	file.Seek(start, 0)
	chunkSize := end - start + 1
	buffer := make([]byte, chunkSize)
	file.Read(buffer)
	c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
	c.Header("Content-Length", fmt.Sprintf("%d", chunkSize))
	c.Status(http.StatusPartialContent)
	c.Writer.Write(buffer)
}
func CleanupUploads() {
	uploadDir := "./uploads/"
	files, _ := os.ReadDir(uploadDir)

	for _, file := range files {
		metaPath := filepath.Join(uploadDir, file.Name()+".meta")
		info, _ := os.Stat(metaPath)
		if time.Since(info.ModTime()).Hours() > 24 {
			os.Remove(metaPath)
			os.Remove(filepath.Join(uploadDir, file.Name()))
		}
	}
}
