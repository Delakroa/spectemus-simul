package com.watchtogether.backend.system;

public record VersionResponse(String name, String version, String buildTime, String apiVersion) {}
