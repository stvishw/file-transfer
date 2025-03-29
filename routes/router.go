package routes

import (
	"fmt"
	"project_10/auth"
	"project_10/handlers"

	"github.com/gin-gonic/gin"
)

func SetupRouter() *gin.Engine {
	router := gin.Default()
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Content-Range")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})
	router.POST("/login", handlers.Login)
	router.GET("/status/:file_id", handlers.StatusCheck)
	authGroup := router.Group("/")
	authGroup.Use(auth.AuthMiddleware())
	{
		authGroup.POST("/init_upload", handlers.InitUpload)
		authGroup.POST("/upload_chunk", handlers.UploadChunk)
	}

	router.GET("/download/:file_id", handlers.DownloadFile)
	for _, route := range router.Routes() {
		fmt.Println("Registered Route:", route.Method, route.Path)
	}

	return router
}
