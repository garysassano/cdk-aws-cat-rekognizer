class CatRekognizer {
  constructor() {
    this.selectedFile = null;
    this.apiEndpointUrl = null;
    this.elements = {
      fileInput: document.getElementById("file_input"),
      dragDropArea: document.getElementById("drag_drop_area"),
      dragDropText: document.getElementById("drag_drop_text"),
      fileName: document.getElementById("file_name"),
      uploadButton: document.getElementById("upload_button"),
    };

    this.init();
  }

  async init() {
    try {
      const config = await this.loadConfig();
      this.apiEndpointUrl = config.apiEndpointUrl;
      this.setupEventListeners();
    } catch (error) {
      console.error("Error initializing CatRekognizer:", error);
      this.showError(
        "Failed to initialize the application. Please try again later.",
      );
    }
  }

  async loadConfig() {
    const response = await fetch("config.json");
    if (!response.ok) {
      throw new Error("Failed to load configuration");
    }
    return response.json();
  }

  setupEventListeners() {
    this.elements.fileInput.addEventListener(
      "change",
      this.handleFileSelect.bind(this),
    );
    this.elements.dragDropArea.addEventListener(
      "drop",
      this.handleDrop.bind(this),
    );
    this.elements.dragDropArea.addEventListener(
      "dragover",
      this.handleDragOver.bind(this),
    );
    this.elements.dragDropArea.addEventListener(
      "click",
      this.triggerFileInput.bind(this),
    );
    this.elements.uploadButton.addEventListener(
      "click",
      this.handleUpload.bind(this),
    );
  }

  triggerFileInput() {
    this.elements.fileInput.click();
  }

  handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length) {
      this.processFile(files[0]);
    }
  }

  handleFileSelect(event) {
    if (event.target.files.length) {
      this.processFile(event.target.files[0]);
    }
  }

  processFile(file) {
    this.selectedFile = file;
    this.elements.fileName.textContent = `Selected file: ${file.name}`;
    this.elements.uploadButton.disabled = false;
    this.elements.dragDropText.style.display = "none";
    this.previewImage(file);
  }

  previewImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.elements.dragDropArea.style.backgroundImage = `url(${e.target.result})`;
    };
    reader.readAsDataURL(file);
  }

  async handleUpload() {
    if (!this.selectedFile) return;

    try {
      await this.uploadToS3(this.selectedFile);
      this.showSuccess("File uploaded successfully.");
    } catch (error) {
      console.error("Error uploading file:", error);
      this.showError("Error uploading file. Please try again.");
    }
  }

  async uploadToS3(file) {
    const presignedUrlResponse = await this.getPresignedUrl(file.name);
    const uploadResponse = await fetch(presignedUrlResponse.putPresignedUrl, {
      method: "PUT",
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error("File upload failed");
    }
  }

  async getPresignedUrl(filename) {
    const response = await fetch(`${this.apiEndpointUrl}/presign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filename }),
    });

    if (!response.ok) {
      throw new Error("Failed to get presigned URL");
    }

    return response.json();
  }

  showSuccess(message) {
    alert(message); // Replace with a better UI notification in the future
  }

  showError(message) {
    alert(message); // Replace with a better UI notification in the future
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  new CatRekognizer();
});
