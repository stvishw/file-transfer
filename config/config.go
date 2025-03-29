package config

import "time"

const (
	SecretKey             = "secret-key"
	TokenExpiration       = 30 * time.Minute
	ChunkSize             = 1 << 20
	UploadDir             = "uploads"
	TempDir               = "temp"
	CleanupInterval       = 1 * time.Hour
	MaxMemory       int64 = 32 << 20
)
