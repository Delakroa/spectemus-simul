package com.watchtogether.backend.room;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.Cookie;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.api.ApiExceptionHandler;
import com.watchtogether.backend.api.CorrelationIdFilter;
import com.watchtogether.backend.config.SecurityConfig;
import com.watchtogether.backend.room.CreateRoomResponse.Participant;
import com.watchtogether.backend.room.CreateRoomResponse.RoomSnapshot;
import com.watchtogether.backend.room.RoomCreationService.CreationResult;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(RoomController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, CorrelationIdFilter.class})
class RoomControllerTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String HOST_SECRET = "A".repeat(43);
    private static final String SESSION = "B".repeat(43);

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private RoomCreationService roomCreationService;

    @MockitoBean
    private RoomRestoreService roomRestoreService;

    @MockitoBean
    private RoomJoinService roomJoinService;

    @MockitoBean
    private RoomCloseService roomCloseService;

    @MockitoBean
    private RoomLeaveService roomLeaveService;

    @MockitoBean
    private RoomProperties roomProperties;

    @BeforeEach
    void setUp() {
        when(roomProperties.sessionCookieSecure()).thenReturn(false);
    }

    @Test
    void createsRoomAccordingToContract() throws Exception {
        when(roomCreationService.create("create-room-key-0001", "Host"))
                .thenReturn(creationResult());

        mockMvc.perform(post("/api/v1/rooms")
                        .header("Idempotency-Key", "create-room-key-0001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"hostDisplayName":"Host"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.LOCATION, "/api/v1/rooms/" + ROOM_ID))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("HttpOnly")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("SameSite=Strict")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, not(containsString("Secure"))))
                .andExpect(cookie().value("wt_session", SESSION))
                .andExpect(jsonPath("$.room.roomId").value(ROOM_ID))
                .andExpect(jsonPath("$.room.status").value("CREATED"))
                .andExpect(jsonPath("$.room.roomVersion").value(0))
                .andExpect(jsonPath("$.room.participants[0].role").value("HOST"))
                .andExpect(jsonPath("$.hostSecret").value(HOST_SECRET))
                .andExpect(jsonPath("$.invitePath").value("/rooms/" + ROOM_ID))
                .andExpect(content().string(not(containsString("/rooms/" + ROOM_ID + "?"))));
    }

    @Test
    void restoresRoomAccordingToContract() throws Exception {
        GetRoomResponse response = restoreResponse();
        when(roomRestoreService.restore(ROOM_ID, SESSION)).thenReturn(response);

        mockMvc.perform(get("/api/v1/rooms/{roomId}", ROOM_ID)
                        .cookie(new Cookie("wt_session", SESSION)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER))
                .andExpect(jsonPath("$.participant.participantId").value(
                        response.participant().participantId().toString()))
                .andExpect(jsonPath("$.participant.role").value("HOST"))
                .andExpect(jsonPath("$.room.roomId").value(ROOM_ID))
                .andExpect(jsonPath("$.room.status").value("CREATED"))
                .andExpect(jsonPath("$.room.participants[0].role").value("HOST"));

        verify(roomRestoreService).restore(ROOM_ID, SESSION);
    }

    @Test
    void returnsProblemDetailsWhenIdempotencyHeaderIsMissing() throws Exception {
        mockMvc.perform(post("/api/v1/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"hostDisplayName":"Host"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(header().exists(CorrelationIdFilter.HEADER))
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"))
                .andExpect(jsonPath("$.correlationId").exists())
                .andExpect(jsonPath("$.retryable").value(false));
    }

    @Test
    void returnsValidationProblemForBlankHostName() throws Exception {
        mockMvc.perform(post("/api/v1/rooms")
                        .header("Idempotency-Key", "create-room-key-0002")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"hostDisplayName":"   "}
                                """))
                .andExpect(status().isUnprocessableContent())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.violations[0].field").value("hostDisplayName"));
    }

    @Test
    void rejectsUnknownRequestField() throws Exception {
        mockMvc.perform(post("/api/v1/rooms")
                        .header("Idempotency-Key", "create-room-key-0003")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"hostDisplayName":"Host","unexpected":true}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));
    }

    @Test
    void returnsConflictForReusedIdempotencyKeyWithDifferentPayload() throws Exception {
        when(roomCreationService.create(anyString(), anyString()))
                .thenThrow(ApiException.conflict(
                        "IDEMPOTENCY_CONFLICT",
                        "Конфликт idempotency key",
                        "Этот Idempotency-Key уже использован с другим запросом."));

        mockMvc.perform(post("/api/v1/rooms")
                        .header("Idempotency-Key", "create-room-key-0003")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"hostDisplayName":"Host"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"))
                .andExpect(jsonPath("$.retryable").value(false));
    }

    @Test
    void closesRoomAccordingToContract() throws Exception {
        mockMvc.perform(post("/api/v1/rooms/{roomId}/close", ROOM_ID)
                        .cookie(new Cookie("wt_session", SESSION))
                        .header("X-Host-Secret", HOST_SECRET))
                .andExpect(status().isNoContent())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER));

        verify(roomCloseService).close(ROOM_ID, SESSION, HOST_SECRET);
    }

    @Test
    void leavesRoomAccordingToContract() throws Exception {
        mockMvc.perform(post("/api/v1/rooms/{roomId}/leave", ROOM_ID)
                        .cookie(new Cookie("wt_session", SESSION)))
                .andExpect(status().isNoContent())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER));

        verify(roomLeaveService).leave(ROOM_ID, SESSION);
    }

    private CreationResult creationResult() {
        Instant now = Instant.parse("2026-07-09T08:00:00Z");
        UUID hostId = UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
        Participant host =
                new Participant(hostId, "Host", ParticipantRole.HOST, true, now);
        RoomSnapshot room = new RoomSnapshot(
                ROOM_ID,
                RoomStatus.CREATED,
                hostId,
                List.of(host),
                null,
                0,
                now.plus(Duration.ofHours(4)),
                now);
        CreateRoomResponse response =
                new CreateRoomResponse(room, HOST_SECRET, "/rooms/" + ROOM_ID);
        return new CreationResult(response, SESSION, Duration.ofHours(4));
    }

    private GetRoomResponse restoreResponse() {
        CreateRoomResponse response = creationResult().response();
        return new GetRoomResponse(response.room().participants().getFirst(), response.room());
    }
}
